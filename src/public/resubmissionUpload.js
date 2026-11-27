import { putStudentDocumentDirect } from './applicationApi.js';
import { createMultiPageDocumentPdf } from './multiFileDocument.js';
import {
    openRequirementDocumentComposer,
    populateDocumentCard,
    readUploadCardMessages,
    updateDocumentUploadProgress
} from './documentUploadCard.js';

const MERGE_IMAGE_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const ACTIVE_UPLOAD_STATES = Object.freeze(['preparing', 'uploading', 'verifying']);
const MERGE_ERROR_MESSAGE_KEYS = Object.freeze({
    TOO_MANY_FILES: 'tooManyFiles',
    INVALID_FILE: 'invalidFileType',
    FILE_TOO_LARGE: 'fileTooLarge',
    MULTI_FILE_PROCESSING_FAILED: 'multiFileProcessingFailed'
});

function readErrorKey(error) {
    if (error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED') {
        return 'resubmissionUploadSessionExpired';
    }
    if (error?.code === 'UPLOAD_CAPABILITY_EXPIRED') return 'resubmissionUploadCapabilityExpired';
    if (error?.status === 409 || error?.code === 'RESUBMISSION_UPLOAD_CONFLICT') return 'resubmissionUploadConflict';
    if (error?.code === 'UPLOAD_NETWORK_ERROR' || error?.code === 'NETWORK_ERROR') {
        return 'resubmissionUploadNetworkError';
    }
    return 'resubmissionUploadFailed';
}

function readMergeErrorKey(error) {
    return MERGE_ERROR_MESSAGE_KEYS[error?.code] || 'multiFileProcessingFailed';
}

function isAllowedFile(file, requirement) {
    return Boolean(file && Number.isSafeInteger(file.size) && file.size > 0
        && file.size <= requirement.max_byte_size
        && requirement.accepted_media_types.includes(file.type));
}

function isSessionFailure(error) {
    return error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED';
}

function isUploadActive(task) {
    return Boolean(task && ACTIVE_UPLOAD_STATES.includes(task.state));
}

function getResubmissionStatusTone(_requirement, task) {
    if (!task) return 'error';
    if (task.state === 'complete') return 'success';
    if (['failed_upload', 'failed_finalize', 'unknown_finalize_result'].includes(task.state)) return 'error';
    return 'pending';
}

/**
 * Mounts the owner-only replacement upload control using the shared document card UI.
 * @param {HTMLElement} card Current document card in owner tracking.
 * @param {object} requirement Server-provided code, media allowlist, size limit, and tracking fields.
 * @param {object} api Owner-only intent and finalize functions.
 * @param {object} [options] Locale messages, progress transport, PDF merger, composer, and lifecycle callbacks.
 * @returns {{card: HTMLElement, fileInput: HTMLInputElement, button: HTMLButtonElement, status: HTMLParagraphElement, retryButton: HTMLButtonElement|null, cancelButton: HTMLButtonElement|null}} Mounted controls.
 */
export function initializeResubmissionUpload(card, requirement, api, options = {}) {
    const document = card.ownerDocument;
    const baseMessages = readUploadCardMessages(document);
    const messages = options.messages ? { ...baseMessages, ...options.messages } : baseMessages;
    const mergeFilesToPdf = options.createMultiPageDocumentPdf || createMultiPageDocumentPdf;
    const cardRequirement = {
        ...requirement,
        required: requirement.required ?? requirement.is_required,
        upload_status: requirement.upload_status || (requirement.filename ? 'finalized' : undefined),
        review_status: 'resubmission_required'
    };

    let activeController = null;
    let hasSessionFailure = false;
    let selectionGeneration = 0;
    let task = null;

    function renderCard({ ariaInvalid = false, disabled = false } = {}) {
        const state = {
            uploads: task ? { [requirement.code]: task } : {},
            deleting: {}
        };
        populateDocumentCard(card, cardRequirement, state, {
            messages,
            cardClassName: 'tracking-document-card application-document-card',
            allowUpload: true,
            allowDelete: false,
            ariaInvalid,
            disabled: disabled || hasSessionFailure,
            statusId: `resubmission-status-${requirement.code}`,
            statusTone: getResubmissionStatusTone
        });
        card.querySelector('input[type="file"]')?.addEventListener('change', handleFileChange);
    }

    function handleSessionFailure(currentTask, controller) {
        hasSessionFailure = true;
        selectionGeneration += 1;
        if (controller && !controller.signal.aborted) controller.abort();
        if (activeController && !activeController.signal.aborted) activeController.abort();
        activeController = null;
        if (currentTask) {
            currentTask.file = null;
            currentTask.intentId = null;
            currentTask.abortController = null;
            currentTask.state = 'failed_upload';
            currentTask.statusKey = null;
            currentTask.errorKey = 'resubmissionUploadSessionExpired';
        }
        document.getElementById('pdf-merger-modal-overlay')?.remove();
        renderCard({ ariaInvalid: true, disabled: true });
        options.onSessionFailure?.();
    }

    async function finalizeTask(currentTask, expectedGeneration) {
        currentTask.state = 'verifying';
        currentTask.statusKey = 'resubmissionUploadVerifying';
        currentTask.errorKey = null;
        renderCard();
        try {
            const finalizeResult = await api.finalizeResubmissionUpload(currentTask.intentId);
            if (expectedGeneration !== selectionGeneration || hasSessionFailure) return 'stale';
            currentTask.state = 'complete';
            currentTask.file = null;
            currentTask.intentId = null;
            currentTask.statusKey = 'resubmissionUploadComplete';
            currentTask.errorKey = null;
            renderCard();
            try {
                await options.onComplete?.(requirement.code, finalizeResult?.document || finalizeResult);
            } catch (error) {
                if (isSessionFailure(error)) {
                    handleSessionFailure(currentTask);
                    return 'session_expired';
                }
            }
            return 'complete';
        } catch (error) {
            if (isSessionFailure(error)) {
                handleSessionFailure(currentTask);
                return 'session_expired';
            }
            if (expectedGeneration !== selectionGeneration || hasSessionFailure) return 'stale';
            if (['UPLOAD_OBJECT_MISSING', 'UPLOAD_OBJECT_MISMATCH', 'UPLOAD_INTENT_EXPIRED', 'UPLOAD_INTENT_UNAVAILABLE'].includes(error?.code)) {
                currentTask.intentId = null;
                currentTask.state = 'failed_upload';
                currentTask.statusKey = null;
                currentTask.errorKey = readErrorKey(error);
                renderCard({ ariaInvalid: true });
                return 'unavailable';
            }
            // Retry finalize with the same intent_id only after an unknown/network/5xx result.
            // 409 conflicts and capability errors invalidate the intent on the server, so retry must create a new intent.
            const isUnknownResult = error?.code === 'NETWORK_ERROR' || error?.code === 'UPLOAD_NETWORK_ERROR' || error?.status >= 500;
            if (!isUnknownResult) {
                currentTask.intentId = null;
            }
            currentTask.state = isUnknownResult ? 'unknown_finalize_result' : 'failed_finalize';
            currentTask.statusKey = null;
            currentTask.errorKey = readErrorKey(error);
            renderCard({ ariaInvalid: true });
            return 'failed';
        }
    }

    async function runUploadTask(currentTask, expectedGeneration = selectionGeneration) {
        if (!currentTask || isUploadActive(currentTask) || hasSessionFailure) return;
        currentTask.errorKey = null;
        currentTask.statusKey = null;

        if (currentTask.intentId) {
            const outcome = await finalizeTask(currentTask, expectedGeneration);
            if (outcome !== 'unavailable') return;
            if (!currentTask.file || expectedGeneration !== selectionGeneration || hasSessionFailure) return;
        }

        if (!isAllowedFile(currentTask.file, requirement)) {
            currentTask.state = 'failed_upload';
            currentTask.errorKey = currentTask.file && Number.isSafeInteger(currentTask.file.size) && currentTask.file.size > requirement.max_byte_size
                ? 'fileTooLarge'
                : 'resubmissionUploadInvalidFile';
            renderCard({ ariaInvalid: true });
            return;
        }

        currentTask.state = 'preparing';
        currentTask.progress = 0;
        currentTask.statusKey = 'resubmissionUploadPreparing';
        const currentController = new AbortController();
        activeController = currentController;
        currentTask.abortController = currentController;
        renderCard();

        let upload;
        try {
            ({ upload } = await api.createResubmissionUploadIntent(requirement.code, currentTask.file));
        } catch (error) {
            if (activeController === currentController) activeController = null;
            currentTask.abortController = null;
            if (isSessionFailure(error)) {
                handleSessionFailure(currentTask, currentController);
                return;
            }
            if (currentController.signal.aborted || expectedGeneration !== selectionGeneration || hasSessionFailure) return;
            currentTask.state = 'failed_upload';
            currentTask.statusKey = null;
            currentTask.errorKey = readErrorKey(error);
            renderCard({ ariaInvalid: true });
            return;
        }

        if (currentController.signal.aborted || expectedGeneration !== selectionGeneration || hasSessionFailure) {
            if (activeController === currentController) activeController = null;
            currentTask.abortController = null;
            return;
        }

        currentTask.intentId = upload.intent_id;
        currentTask.state = 'uploading';
        currentTask.statusKey = 'resubmissionUploadProgress';
        renderCard();

        try {
            await (options.putStudentDocumentDirect || putStudentDocumentDirect)(upload, currentTask.file, {
                signal: currentController.signal,
                XMLHttpRequestClass: options.XMLHttpRequestClass,
                onProgress: (percent) => {
                    if (!currentController.signal.aborted && expectedGeneration === selectionGeneration && !hasSessionFailure) {
                        currentTask.progress = percent;
                        updateDocumentUploadProgress(card, currentTask, messages);
                    }
                }
            });
        } catch (error) {
            if (activeController === currentController) activeController = null;
            currentTask.abortController = null;
            if (isSessionFailure(error)) {
                handleSessionFailure(currentTask, currentController);
                return;
            }
            if (error?.code === 'UPLOAD_CANCELLED' || currentController.signal.aborted) {
                if (expectedGeneration !== selectionGeneration || hasSessionFailure) return;
                currentTask.intentId = null;
                currentTask.state = 'cancelled';
                currentTask.statusKey = null;
                currentTask.errorKey = 'uploadState_cancelled';
                renderCard();
                return;
            }
            if (expectedGeneration !== selectionGeneration || hasSessionFailure) return;
            currentTask.intentId = null;
            currentTask.state = 'failed_upload';
            currentTask.statusKey = null;
            currentTask.errorKey = readErrorKey(error);
            renderCard({ ariaInvalid: true });
            return;
        }

        if (activeController === currentController) activeController = null;
        currentTask.abortController = null;
        if (currentController.signal.aborted || expectedGeneration !== selectionGeneration || hasSessionFailure) return;

        await finalizeTask(currentTask, expectedGeneration);
    }

    card.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button || hasSessionFailure) return;
        const action = button.dataset.action;

        if (action === 'document-compose') {
            if (!requirement.accepted_media_types.includes('application/pdf') || isUploadActive(task)) return;
            await openRequirementDocumentComposer(document, requirement, {
                openPdfMergerModal: options.openPdfMergerModal,
                messages,
                onSaveFile: async (file) => {
                    if (hasSessionFailure) {
                        throw new Error(messages.resubmissionUploadSessionExpired);
                    }
                    selectionGeneration += 1;
                    const currentGeneration = selectionGeneration;
                    if (activeController) {
                        activeController.abort();
                        activeController = null;
                    }
                    if (!isAllowedFile(file, requirement)) {
                        const errorKey = file && Number.isSafeInteger(file.size) && file.size > requirement.max_byte_size
                            ? 'fileTooLarge'
                            : 'resubmissionUploadInvalidFile';
                        task = {
                            state: 'failed_upload',
                            progress: 0,
                            file: null,
                            intentId: null,
                            abortController: null,
                            errorKey,
                            statusKey: null
                        };
                        renderCard({ ariaInvalid: true });
                        throw new Error(messages[errorKey] || messages.resubmissionUploadInvalidFile);
                    }
                    task = {
                        state: 'selected',
                        progress: 0,
                        file,
                        intentId: null,
                        abortController: null,
                        errorKey: null,
                        statusKey: null
                    };
                    await runUploadTask(task, currentGeneration);
                    if (task.state !== 'complete') {
                        throw new Error(messages[task.errorKey || task.statusKey] || messages.resubmissionUploadFailed);
                    }
                }
            });
            return;
        }

        if (action === 'document-retry') {
            if (!task || isUploadActive(task)) return;
            await runUploadTask(task, selectionGeneration);
            return;
        }

        if (action === 'document-cancel') {
            task?.abortController?.abort();
        }
    });

    async function handleFileChange(event) {
        const input = event.target;
        const InputClass = document.defaultView?.HTMLInputElement;
        if (InputClass ? !(input instanceof InputClass) : input?.tagName !== 'INPUT') return;
        if (input.type !== 'file' || hasSessionFailure) return;

        selectionGeneration += 1;
        const currentGeneration = selectionGeneration;
        if (activeController) {
            activeController.abort();
            activeController = null;
        }

        const files = Array.from(input.files || []);
        if (!files.length) {
            task = null;
            renderCard();
            return;
        }

        const isSingleAcceptedFile = files.length === 1 && requirement.accepted_media_types.includes(files[0].type);
        if (isSingleAcceptedFile) {
            if (!isAllowedFile(files[0], requirement)) {
                const errorKey = Number.isSafeInteger(files[0].size) && files[0].size > requirement.max_byte_size
                    ? 'fileTooLarge'
                    : 'resubmissionUploadInvalidFile';
                task = {
                    state: 'failed_upload',
                    progress: 0,
                    file: null,
                    intentId: null,
                    abortController: null,
                    errorKey,
                    statusKey: null
                };
                renderCard({ ariaInvalid: true });
                return;
            }
            task = {
                state: 'selected',
                progress: 0,
                file: files[0],
                intentId: null,
                abortController: null,
                errorKey: null,
                statusKey: null
            };
            await runUploadTask(task, currentGeneration);
            return;
        }

        if (!requirement.accepted_media_types.includes('application/pdf')
            || (files.length === 1 && !MERGE_IMAGE_MEDIA_TYPES.includes(files[0].type))) {
            task = {
                state: 'failed_upload',
                progress: 0,
                file: null,
                intentId: null,
                abortController: null,
                errorKey: 'resubmissionUploadInvalidFile',
                statusKey: null
            };
            renderCard({ ariaInvalid: true });
            return;
        }

        task = {
            state: 'preparing',
            progress: 0,
            file: null,
            intentId: null,
            abortController: null,
            errorKey: null,
            statusKey: 'multiFilePreparing'
        };
        renderCard();

        try {
            const mergedFile = await mergeFilesToPdf(files, {
                maxByteSize: requirement.max_byte_size,
                document
            });
            if (currentGeneration !== selectionGeneration || hasSessionFailure) return;
            if (!isAllowedFile(mergedFile, requirement)) {
                const code = mergedFile && Number.isSafeInteger(mergedFile.size) && mergedFile.size > requirement.max_byte_size
                    ? 'FILE_TOO_LARGE'
                    : 'INVALID_FILE';
                throw Object.assign(new Error(code), { code });
            }
            task.file = mergedFile;
            task.state = 'selected';
            task.statusKey = null;
            await runUploadTask(task, currentGeneration);
        } catch (error) {
            if (currentGeneration !== selectionGeneration || hasSessionFailure) return;
            task.file = null;
            task.state = 'failed_upload';
            task.statusKey = null;
            task.errorKey = readMergeErrorKey(error);
            renderCard({ ariaInvalid: true });
        }
    }

    renderCard();

    return {
        card,
        get fileInput() { return card.querySelector('input[type="file"]'); },
        get button() { return card.querySelector('.application-upload-control > button'); },
        get status() { return card.querySelector('.document-upload-status'); },
        get retryButton() { return card.querySelector('[data-action="document-retry"]'); },
        get cancelButton() { return card.querySelector('[data-action="document-cancel"]'); }
    };
}
