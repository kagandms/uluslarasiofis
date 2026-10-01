import { putStudentDocumentDirect } from './applicationApi.js';

function setStatus(status, message) {
    status.textContent = message;
}

function readErrorMessage(messages, error) {
    if (error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED') {
        return messages.resubmissionUploadSessionExpired;
    }
    if (error?.code === 'UPLOAD_CAPABILITY_EXPIRED') return messages.resubmissionUploadCapabilityExpired;
    if (error?.status === 409 || error?.code === 'RESUBMISSION_UPLOAD_CONFLICT') return messages.resubmissionUploadConflict;
    if (error?.code === 'UPLOAD_NETWORK_ERROR' || error?.code === 'NETWORK_ERROR') {
        return messages.resubmissionUploadNetworkError;
    }
    return messages.resubmissionUploadFailed;
}

function isAllowedFile(file, requirement) {
    return file && Number.isSafeInteger(file.size) && file.size > 0
        && file.size <= requirement.max_byte_size
        && requirement.accepted_media_types.includes(file.type);
}

function isSessionFailure(error) {
    return error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED';
}

/**
 * Mounts the owner-only replacement upload control.
 * @param {HTMLElement} card Current document card in owner tracking.
 * @param {object} requirement Server-provided code, media allowlist, and size limit.
 * @param {object} api Owner-only intent and finalize functions.
 * @param {object} [options] Locale messages, progress transport, and lifecycle callbacks.
 * @returns {{fileInput: HTMLInputElement, button: HTMLButtonElement, status: HTMLParagraphElement}} Mounted controls.
 */
export function initializeResubmissionUpload(card, requirement, api, options = {}) {
    const document = card.ownerDocument;
    const messages = options.messages;
    const section = document.createElement('section');
    const fileInput = document.createElement('input');
    const button = document.createElement('button');
    const status = document.createElement('p');
    let activeController = null;
    let hasSessionFailure = false;

    section.className = 'resubmission-upload-control';
    fileInput.type = 'file';
    fileInput.accept = requirement.accepted_media_types.join(',');
    fileInput.setAttribute('aria-label', messages.resubmissionUploadChooseFile);
    button.type = 'button';
    button.className = 'application-button application-button-primary';
    button.disabled = true;
    button.textContent = messages.resubmissionUploadAction;
    status.className = 'tracking-message';
    status.setAttribute('aria-live', 'polite');
    fileInput.addEventListener('change', () => {
        button.disabled = !isAllowedFile(fileInput.files?.[0], requirement) || hasSessionFailure;
        if (fileInput.files?.length && !isAllowedFile(fileInput.files[0], requirement)) {
            setStatus(status, messages.resubmissionUploadInvalidFile);
        }
    });
    button.addEventListener('click', async () => {
        const file = fileInput.files?.[0];
        if (!isAllowedFile(file, requirement) || hasSessionFailure) {
            setStatus(status, messages.resubmissionUploadInvalidFile);
            return;
        }
        activeController = new AbortController();
        const currentController = activeController;
        button.disabled = true;
        setStatus(status, messages.resubmissionUploadPreparing);
        try {
            const { upload } = await api.createResubmissionUploadIntent(requirement.code, file);
            setStatus(status, messages.resubmissionUploadProgress);
            await (options.putStudentDocumentDirect || putStudentDocumentDirect)(upload, file, {
                signal: currentController.signal,
                XMLHttpRequestClass: options.XMLHttpRequestClass,
                onProgress: (percent) => setStatus(status, `${messages.resubmissionUploadProgress} ${percent}%`)
            });
            setStatus(status, messages.resubmissionUploadVerifying);
            await api.finalizeResubmissionUpload(upload.intent_id);
            setStatus(status, messages.resubmissionUploadComplete);
            try {
                await options.onComplete?.();
            } catch (error) {
                if (isSessionFailure(error)) throw error;
            }
        } catch (error) {
            if (isSessionFailure(error)) {
                hasSessionFailure = true;
                currentController.abort();
                fileInput.disabled = true;
                button.disabled = true;
                options.onSessionFailure?.();
                setStatus(status, messages.resubmissionUploadSessionExpired);
                return;
            }
            if (error?.code === 'UPLOAD_CANCELLED' && currentController.signal.aborted) return;
            setStatus(status, readErrorMessage(messages, error));
            button.disabled = false;
        } finally {
            if (activeController === currentController) activeController = null;
        }
    });
    section.append(fileInput, button, status);
    card.append(section);
    return { fileInput, button, status };
}
