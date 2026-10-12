import { renderPhysicalReceiptDraft } from './physical-receipt-view.js';

/** Updates an accessible dialog while keeping the existing workspace DOM intact.
 * @param {HTMLElement} root Workspace. @param {object} state Draft. @param {object} handlers User actions.
 * @returns {void} Opens or updates the intake dialog.
 */
export function renderPhysicalReceiptDialog(root, state, handlers) {
    const document = root.ownerDocument;
    let dialog = root.querySelector('.physical-receipt-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.className = 'physical-receipt-dialog physical-intake-panel';
        dialog.setAttribute('aria-labelledby', 'physical-receipt-dialog-title');
        dialog.addEventListener('cancel', event => { event.preventDefault(); handlers.back(); });
        root.append(dialog);
    }
    dialog.replaceChildren();
    const notice = document.createElement('p');
    notice.id = 'physical-receipt-dialog-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = state.message || '';
    dialog.append(notice);
    renderPhysicalReceiptDraft(dialog, state, handlers);
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector('input[name=first_name]')?.focus();
}

/** Closes the draft dialog before rendering the queue or detail view.
 * @param {HTMLElement} root Workspace. @returns {void} Removes only the intake dialog.
 */
export function closePhysicalReceiptDialog(root) {
    const dialog = root.querySelector('.physical-receipt-dialog');
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
}
