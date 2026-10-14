import { isPdfDocument } from './document-preview-store.js';

function createAction(label, text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', onClick);
    return button;
}

async function showThumbnail(state, entry) {
    if (entry.hasRequestedPreview) return;
    entry.hasRequestedPreview = true;
    try {
        const url = await state.previews.getThumbnail(entry.file);
        if (!url || !entry.card.isConnected) return;
        const image = document.createElement('img');
        image.src = url;
        image.alt = `${entry.label} küçük önizlemesi`;
        image.draggable = false;
        entry.previewButton.replaceChildren(image);
    } catch {
        entry.previewButton.textContent = isPdfDocument(entry.file) ? 'PDF' : 'Fotoğraf';
        entry.previewButton.title = 'Küçük önizleme hazırlanamadı; belgeyi açmak için tıklayın.';
    }
}

function handleVisibility(state, observations) {
    for (const observation of observations) {
        if (!observation.isIntersecting) continue;
        state.observer.unobserve(observation.target);
        const entry = state.entries.find(candidate => candidate.card === observation.target);
        if (entry) void showThumbnail(state, entry);
    }
}

function createEntry(state, file) {
    const label = isPdfDocument(file) ? `PDF ${++state.nextPdfNumber}` : `Fotoğraf ${++state.nextPhotoNumber}`;
    const card = document.createElement('article');
    card.className = 'pdf-merger-file-card';
    card.draggable = true;
    const number = document.createElement('span');
    number.className = 'pdf-merger-file-position';
    const previewButton = createAction(`${label} önizlemesini aç`, isPdfDocument(file) ? 'PDF' : 'Fotoğraf',
        () => state.previewDialog.open(file, label, previewButton));
    previewButton.className = 'pdf-merger-thumbnail';
    const entry = { file, label, card, number, previewButton, position: 0, hasRequestedPreview: false };
    const details = createDetails(state, entry);
    card.append(number, previewButton, details);
    bindDragEvents(state, entry);
    return entry;
}

function createDetails(state, entry) {
    const details = document.createElement('div');
    details.className = 'pdf-merger-file-details';
    const label = document.createElement('strong');
    label.textContent = entry.label;
    const source = document.createElement('small');
    source.className = 'pdf-merger-file-source';
    source.textContent = /^Telefondan_/i.test(entry.file.name) ? 'Telefondan' : entry.file.name;
    source.title = entry.file.name;
    const actions = createActions(state, entry);
    details.append(label, source, actions);
    return details;
}

function createActions(state, entry) {
    const actions = document.createElement('div');
    actions.className = 'pdf-merger-file-actions';
    entry.up = createAction(`${entry.label} yukarı taşı`, '↑', () => state.onMove(entry.position, entry.position - 1));
    entry.down = createAction(`${entry.label} aşağı taşı`, '↓', () => state.onMove(entry.position, entry.position + 1));
    const remove = createAction(`${entry.label} sil`, '✕', () => state.onRemove(entry.position));
    const dragHandle = createAction(`${entry.label} sürükleyerek sırala`, '⠿', () => {});
    dragHandle.className = 'btn btn-outline pdf-merger-drag-handle';
    dragHandle.draggable = true;
    actions.append(dragHandle, entry.up, entry.down, remove);
    return actions;
}

function clearDrag(state) {
    state.draggedEntry = null;
    for (const entry of state.entries) entry.card.classList.remove('is-dragging', 'drop-before', 'drop-after');
}

function getDropPosition(event, entry) {
    const rectangle = entry.card.getBoundingClientRect();
    return event.clientY < rectangle.top + rectangle.height / 2 ? 'before' : 'after';
}

function dropEntry(state, event, entry) {
    if (!state.draggedEntry || !state.canInteract()) return;
    event.preventDefault();
    event.stopPropagation();
    const fromIndex = state.draggedEntry.position;
    const insertionIndex = entry.position + (getDropPosition(event, entry) === 'after' ? 1 : 0);
    const toIndex = insertionIndex - (fromIndex < insertionIndex ? 1 : 0);
    clearDrag(state);
    if (toIndex !== fromIndex) state.onMove(fromIndex, toIndex);
}

function bindDragEvents(state, entry) {
    entry.card.addEventListener('dragstart', event => {
        if (!state.canInteract()) { event.preventDefault(); return; }
        state.draggedEntry = entry;
        event.dataTransfer?.setData('text/plain', entry.label);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        entry.card.classList.add('is-dragging');
    });
    entry.card.addEventListener('dragover', event => {
        if (!state.draggedEntry || state.draggedEntry === entry || !state.canInteract()) return;
        event.preventDefault();
        for (const candidate of state.entries) candidate.card.classList.remove('drop-before', 'drop-after');
        entry.card.classList.add(`drop-${getDropPosition(event, entry)}`);
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    entry.card.addEventListener('dragleave', () => entry.card.classList.remove('drop-before', 'drop-after'));
    entry.card.addEventListener('drop', event => dropEntry(state, event, entry));
    entry.card.addEventListener('dragend', () => clearDrag(state));
}

function collectAvailableEntries(state) {
    const available = new Map();
    for (const entry of state.entries) {
        if (!available.has(entry.file)) available.set(entry.file, []);
        available.get(entry.file).push(entry);
    }
    return available;
}

function showEmptyList(state) {
    const empty = document.createElement('p');
    empty.className = 'pdf-merger-empty-list';
    empty.textContent = 'Henüz hiçbir belge eklenmedi. Fotoğraf çekebilir veya dosya seçebilirsiniz.';
    state.container.replaceChildren(empty);
}

function syncGallery(state, files) {
    const available = collectAvailableEntries(state);
    const nextEntries = files.map(file => available.get(file)?.shift() || createEntry(state, file));
    const retained = new Set(nextEntries);
    for (const entry of state.entries) if (!retained.has(entry)) { state.observer?.unobserve(entry.card); entry.card.remove(); }
    state.entries = nextEntries;
    state.previews.retainFiles(files);
    if (!state.entries.length) { showEmptyList(state); return; }
    state.container.querySelector('.pdf-merger-empty-list')?.remove();
    const focused = document.activeElement;
    for (const [position, entry] of state.entries.entries()) {
        entry.position = position;
        entry.number.textContent = String(position + 1);
        entry.card.setAttribute('aria-label', `${position + 1}. sırada ${entry.label}`);
        entry.up.disabled = position === 0;
        entry.down.disabled = position === state.entries.length - 1;
        state.container.append(entry.card);
        if (!entry.hasRequestedPreview) {
            if (state.observer) state.observer.observe(entry.card);
            else void showThumbnail(state, entry);
        }
    }
    if (focused?.isConnected && state.container.contains(focused)) focused.focus({ preventScroll: true });
}

function disposeGallery(state) {
    state.observer?.disconnect();
    clearDrag(state);
    state.previewDialog.dispose();
    state.previews.dispose();
    state.entries = [];
}

/** Maintains file cards, stable labels and local previews while order changes.
 * @param {object} options Container, preview services and guarded move/remove callbacks.
 * @returns {object} List synchronization and disposal operations. */
export function createPdfMergerGallery(options) {
    const state = { ...options, entries: [], draggedEntry: null, nextPhotoNumber: 0, nextPdfNumber: 0, observer: null };
    if (typeof IntersectionObserver === 'function') {
        state.observer = new IntersectionObserver(observations => handleVisibility(state, observations), { rootMargin: '160px' });
    }
    return { sync: files => syncGallery(state, files), dispose: () => disposeGallery(state) };
}
