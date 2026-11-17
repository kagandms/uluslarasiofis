import { putStudentDocumentDirect } from './applicationApi.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';
import { createMultiPageDocumentPdf } from './multiFileDocument.js';

const MERGE_IMAGE_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MERGE_ERROR_MESSAGE_KEYS = Object.freeze({
    TOO_MANY_FILES: 'tooManyFiles',
    INVALID_FILE: 'invalidFileType',
    FILE_TOO_LARGE: 'fileTooLarge',
    MULTI_FILE_PROCESSING_FAILED: 'multiFileProcessingFailed'
});

function readMessages(document) {
    const locale = document?.documentElement?.lang || 'tr';
    const closeoutMessages = SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr;
    const publicMessages = PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr;
    return { ...closeoutMessages, ...publicMessages };
}

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

function readMergeErrorMessage(messages, error) {
    const key = MERGE_ERROR_MESSAGE_KEYS[error?.code] || 'multiFileProcessingFailed';
    return messages[key] || messages.resubmissionUploadInvalidFile;
}

function isAllowedFile(file, requirement) {
    return file && Number.isSafeInteger(file.size) && file.size > 0
        && file.size <= requirement.max_byte_size
        && requirement.accepted_media_types.includes(file.type);
}

function isSessionFailure(error) {
    return error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED';
}

function buildAcceptAttribute(requirement) {
    // Başvuru sihirbazıyla uyumlu olarak PDF kabul eden alanlarda birleştirilebilir görselleri de seçilebilir yap.
    const acceptedTypes = new Set(requirement.accepted_media_types);
    if (acceptedTypes.has('application/pdf')) {
        MERGE_IMAGE_MEDIA_TYPES.forEach((type) => acceptedTypes.add(type));
    }
    return [...acceptedTypes].join(',');
}

async function readPdfPageCount(file, fallbackCount) {
    if (typeof file?.arrayBuffer !== 'function') return fallbackCount;
    try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDocument = await PDFDocument.load(await file.arrayBuffer());
        const pageCount = pdfDocument.getPageCount();
        return Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : fallbackCount;
    } catch {
        return fallbackCount;
    }
}

function formatMergedReadyStatus(messages, fileCount, pageCount) {
    return messages.resubmissionUploadMergedReady
        .replace('{files}', String(fileCount))
        .replace('{pages}', String(pageCount));
}

function setValidationAlert(fileInput, button, status, message) {
    button.disabled = true;
    fileInput.setAttribute('aria-invalid', 'true');
    status.setAttribute('role', 'alert');
    setStatus(status, message);
}

/**
 * Mounts the owner-only replacement upload control.
 * @param {HTMLElement} card Current document card in owner tracking.
 * @param {object} requirement Server-provided code, media allowlist, and size limit.
 * @param {object} api Owner-only intent and finalize functions.
 * @param {object} [options] Locale messages, progress transport, PDF merger, and lifecycle callbacks.
 * @returns {{fileInput: HTMLInputElement, button: HTMLButtonElement, status: HTMLParagraphElement}} Mounted controls.
 */
export function initializeResubmissionUpload(card, requirement, api, options = {}) {
    const document = card.ownerDocument;
    const baseMessages = readMessages(document);
    const messages = options.messages ? { ...baseMessages, ...options.messages } : baseMessages;
    const mergeFilesToPdf = options.createMultiPageDocumentPdf || createMultiPageDocumentPdf;
    const section = document.createElement('section');
    const label = document.createElement('label');
    const fileInput = document.createElement('input');
    const button = document.createElement('button');
    const status = document.createElement('p');
    let activeController = null;
    let hasSessionFailure = false;
    let preparedFile = null;
    let selectionGeneration = 0;

    section.className = 'resubmission-upload-control';
    fileInput.type = 'file';
    fileInput.id = `resubmission-file-${requirement.code}`;
    fileInput.accept = buildAcceptAttribute(requirement);
    fileInput.multiple = true;
    fileInput.setAttribute('aria-label', messages.resubmissionUploadChooseFile);
    label.htmlFor = fileInput.id;
    label.className = 'resubmission-upload-label';
    label.textContent = messages.resubmissionFileLabel || messages.resubmissionUploadChooseFile;
    button.type = 'button';
    button.className = 'application-button application-button-primary';
    button.disabled = true;
    button.setAttribute('aria-busy', 'false');
    button.textContent = messages.resubmissionUploadAction;
    status.id = `resubmission-status-${requirement.code}`;
    status.className = 'tracking-message';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');
    fileInput.setAttribute('aria-describedby', status.id);

    fileInput.addEventListener('change', async () => {
        if (hasSessionFailure) return;
        // Yeni seçim önceki hazırlanmış dosyayı ve süren birleştirme/yükleme denemesini geçersiz kılar.
        selectionGeneration += 1;
        const currentGeneration = selectionGeneration;
        if (activeController) {
            activeController.abort();
            activeController = null;
            button.setAttribute('aria-busy', 'false');
        }
        preparedFile = null;

        const files = Array.from(fileInput.files || []);
        if (!files.length) {
            button.disabled = true;
            fileInput.setAttribute('aria-invalid', 'false');
            status.setAttribute('role', 'status');
            setStatus(status, '');
            return;
        }

        const isSingleAcceptedFile = files.length === 1 && requirement.accepted_media_types.includes(files[0].type);
        if (isSingleAcceptedFile) {
            const isFileValid = isAllowedFile(files[0], requirement);
            preparedFile = isFileValid ? files[0] : null;
            button.disabled = !isFileValid || hasSessionFailure;
            fileInput.setAttribute('aria-invalid', !isFileValid ? 'true' : 'false');
            if (!isFileValid) {
                status.setAttribute('role', 'alert');
                setStatus(status, messages.resubmissionUploadInvalidFile);
            } else {
                status.setAttribute('role', 'status');
                setStatus(status, '');
            }
            return;
        }

        // PDF kabul edilmiyorsa veya tek dosya birleştirilebilir görsel türünde değilse doğrudan reddet.
        if (!requirement.accepted_media_types.includes('application/pdf')
            || (files.length === 1 && !MERGE_IMAGE_MEDIA_TYPES.includes(files[0].type))) {
            setValidationAlert(fileInput, button, status, messages.resubmissionUploadInvalidFile);
            return;
        }

        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        fileInput.setAttribute('aria-invalid', 'false');
        status.setAttribute('role', 'status');
        setStatus(status, messages.multiFilePreparing);

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
            const pageCount = await readPdfPageCount(mergedFile, files.length);
            if (currentGeneration !== selectionGeneration || hasSessionFailure) return;
            preparedFile = mergedFile;
            button.disabled = hasSessionFailure;
            button.setAttribute('aria-busy', 'false');
            fileInput.setAttribute('aria-invalid', 'false');
            status.setAttribute('role', 'status');
            setStatus(status, formatMergedReadyStatus(messages, files.length, pageCount));
        } catch (error) {
            if (currentGeneration !== selectionGeneration || hasSessionFailure) return;
            preparedFile = null;
            button.setAttribute('aria-busy', 'false');
            setValidationAlert(fileInput, button, status, readMergeErrorMessage(messages, error));
        }
    });

    button.addEventListener('click', async () => {
        const file = preparedFile;
        if (!isAllowedFile(file, requirement) || hasSessionFailure) {
            setValidationAlert(fileInput, button, status, messages.resubmissionUploadInvalidFile);
            return;
        }
        fileInput.setAttribute('aria-invalid', 'false');
        activeController = new AbortController();
        const currentController = activeController;
        const uploadGeneration = selectionGeneration;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        status.setAttribute('role', 'status');
        setStatus(status, messages.resubmissionUploadPreparing);
        try {
            const { upload } = await api.createResubmissionUploadIntent(requirement.code, file);
            if (currentController.signal.aborted || uploadGeneration !== selectionGeneration) return;
            setStatus(status, messages.resubmissionUploadProgress);
            await (options.putStudentDocumentDirect || putStudentDocumentDirect)(upload, file, {
                signal: currentController.signal,
                XMLHttpRequestClass: options.XMLHttpRequestClass,
                onProgress: (percent) => {
                    if (!currentController.signal.aborted && uploadGeneration === selectionGeneration) {
                        setStatus(status, `${messages.resubmissionUploadProgress} ${percent}%`);
                    }
                }
            });
            if (currentController.signal.aborted || uploadGeneration !== selectionGeneration) return;
            setStatus(status, messages.resubmissionUploadVerifying);
            const finalizeResult = await api.finalizeResubmissionUpload(upload.intent_id);
            if (currentController.signal.aborted || uploadGeneration !== selectionGeneration) return;
            button.setAttribute('aria-busy', 'false');
            setStatus(status, messages.resubmissionUploadComplete);
            try {
                await options.onComplete?.(requirement.code, finalizeResult?.document || finalizeResult);
            } catch (error) {
                if (isSessionFailure(error)) throw error;
            }
        } catch (error) {
            if (isSessionFailure(error)) {
                hasSessionFailure = true;
                selectionGeneration += 1;
                preparedFile = null;
                currentController.abort();
                button.setAttribute('aria-busy', 'false');
                status.setAttribute('role', 'alert');
                fileInput.setAttribute('aria-invalid', 'true');
                fileInput.disabled = true;
                button.disabled = true;
                options.onSessionFailure?.();
                setStatus(status, messages.resubmissionUploadSessionExpired);
                return;
            }
            if ((error?.code === 'UPLOAD_CANCELLED' && currentController.signal.aborted)
                || currentController.signal.aborted
                || uploadGeneration !== selectionGeneration) {
                return;
            }
            button.setAttribute('aria-busy', 'false');
            status.setAttribute('role', 'alert');
            fileInput.setAttribute('aria-invalid', 'true');
            setStatus(status, readErrorMessage(messages, error));
            button.disabled = false;
        } finally {
            if (activeController === currentController) activeController = null;
        }
    });
    section.append(label, fileInput, button, status);
    card.append(section);
    return { fileInput, button, status };
}
