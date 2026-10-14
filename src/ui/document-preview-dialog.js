import { isPdfDocument } from './document-preview-store.js';

function closePreview(state) {
    if (!state.activePreview) return;
    const { overlay, trigger, background } = state.activePreview;
    overlay.remove();
    for (const [element, wasInert] of background) element.inert = wasInert;
    state.activePreview = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function createHeader(state, label) {
    const header = document.createElement('div');
    header.className = 'pdf-merger-preview-header';
    const title = document.createElement('strong');
    title.textContent = label;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Önizlemeyi kapat';
    closeButton.addEventListener('click', () => closePreview(state));
    header.append(title, closeButton);
    return header;
}

function handlePreviewKeydown(state, event) {
    if (event.key === 'Escape') { event.stopPropagation(); closePreview(state); return; }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    state.activePreview?.overlay.querySelector('button').focus();
}

function openPreview(state, { file, label, trigger }) {
    if (!state.canInteract()) return;
    closePreview(state);
    const overlay = document.createElement('section');
    overlay.className = 'pdf-merger-preview';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${label} önizlemesi`);
    const content = document.createElement(isPdfDocument(file) ? 'iframe' : 'img');
    content.src = state.previews.getOriginal(file);
    content.setAttribute(isPdfDocument(file) ? 'title' : 'alt', label);
    content.className = 'pdf-merger-preview-content';
    const header = createHeader(state, label);
    overlay.append(header, content);
    overlay.addEventListener('keydown', event => handlePreviewKeydown(state, event));
    const background = new Map([...state.modal.children].map(element => [element, element.inert]));
    for (const element of background.keys()) element.inert = true;
    state.modal.append(overlay);
    state.activePreview = { overlay, trigger, background };
    header.querySelector('button').focus();
}

/** Shows one local file at a readable size and restores focus on close.
 * @param {object} options Parent modal, local preview store and processing guard.
 * @returns {object} Open, close and disposal operations. */
export function createDocumentPreviewDialog(options) {
    const state = { ...options, activePreview: null };
    return {
        open: (file, label, trigger) => openPreview(state, { file, label, trigger }),
        close: () => closePreview(state), dispose: () => closePreview(state)
    };
}
