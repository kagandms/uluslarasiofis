/**
 * Accessible native <dialog> confirmation and error formatting for permanent record deletion.
 */

function buildSubject(name, number) {
    return [name, number]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .join(' · ');
}

function buildBodyText({ name, number, kind }) {
    const subject = buildSubject(name, number);
    if (kind === 'physical') {
        return subject
            ? `${subject} fiziksel teslim kaydı ve PDF dosyaları KALICI olarak silinecek. Bu işlem geri alınamaz.`
            : 'Bu fiziksel teslim kaydı ve PDF dosyaları KALICI olarak silinecek. Bu işlem geri alınamaz.';
    }
    return subject
        ? `${subject} kaydı, yüklenen belgeleri ve tüm bilgileriyle birlikte KALICI olarak silinecek. Bu işlem geri alınamaz.`
        : 'Bu kayıt, yüklenen belgeleri ve tüm bilgileriyle birlikte KALICI olarak silinecek. Bu işlem geri alınamaz.';
}

/**
 * Formats API errors from permanent delete endpoints into clear Turkish staff messages.
 * @param {Error & { status?: number, code?: string }} error API error object.
 * @returns {string} Localized Turkish error message.
 */
export function formatPermanentDeleteError(error) {
    const status = error?.status;
    const code = String(error?.code || '');
    if (status === 403) {
        return 'Kalıcı silme için yönetici yetkisi gerekir.';
    }
    if (status === 409 && code === 'APPLICATION_SPREADSHEET_TRANSFER_PRESENT') {
        return error?.message || 'Kayıt e-tabloda bulunduğu için silinemedi.';
    }
    if (status === 409) {
        return 'Kayıt başka bir işlemle değişti. Listeyi yenileyin.';
    }
    if (status === 503 && /_PURGE_RETRY_REQUIRED$/.test(code)) {
        return 'Silme tamamlanamadı; tekrar deneyin.';
    }
    return 'Silme işlemi tamamlanamadı. Tekrar deneyin.';
}

/**
 * Opens an accessible native <dialog> asking staff to confirm permanent deletion.
 * @param {Document} document Owner document.
 * @param {{ title?: string, name?: string, number?: string, kind?: 'online'|'physical', trigger?: HTMLElement|null }} [options] Record metadata.
 * @returns {Promise<boolean>} Resolves true only when staff clicks "Evet, kalıcı olarak sil".
 */
export function confirmPermanentDelete(document, options = {}) {
    const { title, name, number, kind = 'online', trigger = null } = options;
    const returnFocusTo = (trigger && typeof trigger.focus === 'function')
        ? trigger
        : (document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null);

    const dialog = document.createElement('dialog');
    dialog.className = 'permanent-delete-dialog';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'permanent-delete-dialog-title');
    dialog.setAttribute('aria-describedby', 'permanent-delete-dialog-body');

    const card = document.createElement('div');
    card.className = 'permanent-delete-dialog-card';

    const heading = document.createElement('h3');
    heading.id = 'permanent-delete-dialog-title';
    heading.className = 'permanent-delete-dialog-title';
    heading.textContent = title || 'Emin misiniz?';

    const body = document.createElement('p');
    body.id = 'permanent-delete-dialog-body';
    body.className = 'permanent-delete-dialog-body';
    body.textContent = buildBodyText({ name, number, kind });

    const actions = document.createElement('div');
    actions.className = 'permanent-delete-dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-outline permanent-delete-cancel';
    cancelButton.dataset.action = 'cancel-permanent-delete';
    cancelButton.autofocus = true;
    cancelButton.textContent = 'Vazgeç';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn-danger btn-permanent-delete permanent-delete-confirm';
    confirmButton.dataset.action = 'confirm-permanent-delete';
    confirmButton.textContent = 'Evet, kalıcı olarak sil';

    actions.append(cancelButton, confirmButton);
    card.append(heading, body, actions);
    dialog.append(card);
    document.body.append(dialog);

    return new Promise((resolve) => {
        let settled = false;

        const finish = (confirmed) => {
            if (settled) return;
            settled = true;
            dialog.removeEventListener('keydown', onKeydown);
            dialog.removeEventListener('cancel', onCancel);
            dialog.removeEventListener('click', onBackdropClick);
            if (dialog.open && typeof dialog.close === 'function') {
                dialog.close();
            } else {
                dialog.removeAttribute('open');
            }
            dialog.remove();
            if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === 'function') {
                returnFocusTo.focus();
            }
            resolve(confirmed);
        };

        const onCancel = (event) => {
            event.preventDefault();
            finish(false);
        };

        const onBackdropClick = (event) => {
            if (event.target === dialog) {
                finish(false);
            }
        };

        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
                return;
            }
            if (event.key === 'Tab') {
                const focusables = [cancelButton, confirmButton];
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (event.shiftKey) {
                    if (document.activeElement === first || !dialog.contains(document.activeElement)) {
                        event.preventDefault();
                        last.focus();
                    }
                } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        cancelButton.addEventListener('click', () => finish(false));
        confirmButton.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', onCancel);
        dialog.addEventListener('click', onBackdropClick);
        dialog.addEventListener('keydown', onKeydown);

        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        cancelButton.focus();
    });
}

/**
 * Executes the full confirmation, API call, row progress, removal, error handling, and queue refresh
 * for permanently deleting a physical intake record.
 * @param {object} context Physical intake manager context.
 * @param {object} intake Target physical intake row/detail object.
 * @param {HTMLElement|null} trigger Button that opened the dialog (for focus return on cancel).
 * @param {{ render: (ctx: object) => void, splitNoteStatus: (status: string) => object }} deps Collaborators.
 * @returns {Promise<boolean>} True if the record was permanently deleted.
 */
export async function performPhysicalPermanentDelete(context, intake, trigger, { render, splitNoteStatus }) {
    if (!intake?.id || context.isBusy || context.confirmingDelete || context.state.deletingId) return false;
    context.confirmingDelete = true;
    let confirmed = false;
    try {
        confirmed = await confirmPermanentDelete(context.root.ownerDocument, {
            name: [intake.first_name, intake.last_name].filter(Boolean).join(' '),
            number: intake.tracking_reference || intake.passport_number || '',
            kind: 'physical',
            trigger
        });
    } finally {
        context.confirmingDelete = false;
    }
    if (!confirmed) return false;
    context.state.deletingId = intake.id;
    render(context);
    let deleted = false;
    try {
        await context.api.deleteIntake(intake.id, {
            lock_version: intake.lock_version,
            confirmed: true
        });
        deleted = true;
        context.state.deletingId = null;
        if (context.state.result?.items) {
            const nextItems = context.state.result.items.filter((entry) => entry.id !== intake.id);
            const pagination = context.state.result.pagination;
            const totalKey = pagination && 'total_items' in pagination ? 'total_items' : 'total';
            const nextTotal = pagination ? Math.max(0, (Number(pagination[totalKey]) || 0) - 1) : 0;
            context.state.result = {
                ...context.state.result,
                items: nextItems,
                pagination: pagination ? { ...pagination, [totalKey]: nextTotal } : pagination
            };
            if (nextItems.length === 0 && context.state.query.page > 1) {
                context.state.query = { ...context.state.query, page: context.state.query.page - 1 };
            }
        }
        if (context.state.view === 'detail') {
            context.state.view = 'queue';
            context.state.detail = null;
            context.state.isRejecting = false;
            context.state.isEditingMetadata = false;
        }
        context.state.message = 'Kalıcı olarak silindi.';
        render(context);
    } catch (error) {
        console.error('Physical intake permanent delete failed.', { errorName: error?.name || 'Error', code: error?.code });
        context.state.deletingId = null;
        context.state.message = formatPermanentDeleteError(error);
        render(context);
    }
    if (deleted) {
        try {
            const requestId = ++context.queueRequestId;
            const result = await context.api.query({ ...context.state.query, ...splitNoteStatus(context.state.query.status) });
            if (requestId === context.queueRequestId) {
                context.state.result = result;
                context.state.recordNotesResult = null;
                context.state.recordNotes.clear();
                context.state.message = 'Kalıcı olarak silindi.';
                render(context);
            }
        } catch (error) {
            console.error('Physical queue refresh after delete failed.', { errorName: error?.name || 'Error', code: error?.code });
        }
    }
    return deleted;
}
