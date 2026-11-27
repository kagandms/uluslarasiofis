import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';
import { PILOT_UX_MESSAGES } from './i18n/pilotUxMessages.js';
import { readPdfMergerMessages } from './i18n/pdf-merger-messages.js';

const MERGE_IMAGE_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const ACTIVE_UPLOAD_STATES = Object.freeze(['preparing', 'uploading', 'verifying']);
const RETRYABLE_UPLOAD_STATES = Object.freeze(['failed_upload', 'failed_finalize', 'unknown_finalize_result', 'cancelled']);

export function readUploadCardMessages(document) {
    const locale = document?.documentElement?.lang || 'tr';
    const closeoutMessages = SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr;
    const publicMessages = PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr;
    const pilotMessages = PILOT_UX_MESSAGES[locale] || PILOT_UX_MESSAGES.tr;
    return { ...closeoutMessages, ...publicMessages, ...pilotMessages };
}

function createTranslatedElement(document, tag, key, text) {
    const element = document.createElement(tag);
    if (key) element.dataset.i18n = key;
    element.textContent = text;
    return element;
}

function createButton(document, messages, key, action, className = 'application-button application-button-secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.dataset.i18n = key;
    button.textContent = messages[key];
    return button;
}

export function getDocumentStatusKey(requirement, task) {
    if (task?.statusKey) return task.statusKey;
    if (task?.state && task.state !== 'complete') return `uploadState_${task.state}`;
    if (requirement.cleanup_status === 'pending') return 'deleteCleanupPending';
    if (requirement.scan_status === 'unsafe') return 'documentScanUnsafe';
    if (requirement.scan_status === 'failed') return 'documentScanFailed';
    if (requirement.review_status === 'approved' || requirement.revision_status === 'approved') return 'documentApproved';
    if (requirement.review_status === 'under_review') return 'documentStaffReview';
    if (requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required') return 'documentNeedsReplacement';
    if (requirement.scan_status === 'pending') return 'documentPendingScan';
    if (requirement.upload_status === 'finalized') return 'uploadedWaitingReview';
    return 'documentNotUploaded';
}

export function getDocumentStatusTone(requirement, task, statusKey, isDeleting) {
    if (isDeleting) return 'pending';
    if (['deleteCleanupPending', 'documentNeedsReplacement', 'documentScanUnsafe', 'documentScanFailed'].includes(statusKey)) return 'error';
    if (['failed_upload', 'failed_finalize', 'unknown_finalize_result'].includes(task?.state)) return 'error';
    if (task?.state === 'complete' || requirement.upload_status === 'finalized'
        || requirement.review_status === 'approved' || requirement.revision_status === 'approved') return 'success';
    return 'pending';
}

function createFilePolicyText(document, requirement, messages) {
    const acceptedTypes = new Set(requirement.accepted_media_types);
    if (acceptedTypes.has('application/pdf')) {
        MERGE_IMAGE_MEDIA_TYPES.forEach((type) => acceptedTypes.add(type));
    }
    const types = [...acceptedTypes].join(', ');
    const locale = document.documentElement.lang || 'tr';
    const size = (requirement.max_byte_size / (1024 * 1024)).toLocaleString(locale);
    return messages.filePolicy.replace('{types}', types).replace('{size}', `${size} MB`);
}

function createRequirementBadge(document, isRequired, messages) {
    const key = isRequired ? 'required' : 'optional';
    const badge = createTranslatedElement(document, 'span', key, messages[key]);
    badge.className = isRequired ? 'requirement-badge is-required' : 'requirement-badge';
    return badge;
}

function appendFilename(document, card, filename) {
    const name = document.createElement('p');
    name.className = 'application-document-filename';
    name.textContent = filename;
    card.append(name);
}

/** Opens the owner's own uploaded file in a new tab; the owner cookie authorizes the request. */
export function createDocumentPreviewLink(document, code, messages) {
    const link = document.createElement('a');
    link.className = 'application-button application-button-secondary document-preview-link';
    link.href = `/api/public/applications/current/documents/${encodeURIComponent(code)}/preview`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.action = 'document-preview';
    link.dataset.i18n = 'previewDocument';
    link.textContent = messages.previewDocument;
    return link;
}

export function createFileInput(document, requirement, task, messages, options = {}) {
    const label = document.createElement('div');
    const textKey = requirement.filename ? 'replaceDocument' : 'uploadDocument';
    const isBusy = ACTIVE_UPLOAD_STATES.includes(task?.state);
    const isDisabled = Boolean(options.disabled) || isBusy;
    // One primary action: opens the photo/file composer, which builds a single PDF from photos, images or PDFs.
    const text = createButton(document, messages, textKey, 'document-compose', 'application-button application-button-primary');
    text.disabled = isDisabled;
    text.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    const input = document.createElement('input');
    const help = document.createElement('small');
    input.type = 'file';
    input.id = `upload-${requirement.code}`;
    const acceptedTypes = new Set(requirement.accepted_media_types);
    if (acceptedTypes.has('application/pdf')) {
        MERGE_IMAGE_MEDIA_TYPES.forEach((type) => acceptedTypes.add(type));
    }
    input.accept = [...acceptedTypes].join(',');
    input.multiple = true;
    input.dataset.documentCode = requirement.code;
    input.disabled = isDisabled;
    if (options.ariaInvalid) input.setAttribute('aria-invalid', 'true');
    const docTitle = messages[requirement.label_key] || messages.documentNotUploaded;
    help.id = `upload-help-${requirement.code}`;
    help.textContent = `${createFilePolicyText(document, requirement, messages)} ${messages.multiFileUploadWarning.replace('{document}', docTitle)}`;
    input.setAttribute('aria-describedby', options.statusId ? `${help.id} ${options.statusId}` : help.id);
    input.tabIndex = -1;
    const inputLabel = document.createElement('label');
    inputLabel.htmlFor = input.id;
    inputLabel.className = 'application-upload-sr';
    inputLabel.textContent = messages[textKey];
    if (!requirement.accepted_media_types.includes('application/pdf')) {
        // Composer builds PDFs only; other policies fall back to the plain file chooser.
        text.dataset.action = 'document-pick';
        text.addEventListener('click', () => input.click());
    }
    label.className = 'application-upload-control';
    label.append(text, inputLabel, input, help);
    return label;
}

export function createUploadProgress(document, task, messages) {
    if (!task || task.state !== 'uploading') return null;
    const wrapper = document.createElement('div');
    const progress = document.createElement('progress');
    const labelText = messages.uploadProgress.replace('{percent}', String(task.progress || 0));
    const label = createTranslatedElement(document, 'span', 'uploadProgress', labelText);
    label.dataset.progressLabel = 'true';
    progress.max = 100;
    progress.value = task.progress || 0;
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(task.progress || 0));
    progress.setAttribute('aria-label', labelText);
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.append(progress, label);
    return wrapper;
}

export function updateDocumentUploadProgress(card, task, messages) {
    const progress = card?.querySelector('progress');
    if (!progress) return;
    const percent = task?.progress || 0;
    const label = messages.uploadProgress.replace('{percent}', String(percent));
    progress.value = percent;
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-label', label);
    const progressLabel = card.querySelector('[data-progress-label]');
    if (progressLabel) progressLabel.textContent = label;
}

export function populateDocumentCard(card, requirement, state, options = {}) {
    const document = card.ownerDocument;
    const messages = options.messages || readUploadCardMessages(document);
    const allowUpload = Boolean(options.allowUpload);
    const allowDelete = options.allowDelete !== false;
    const task = state?.uploads?.[requirement.code];
    const isDeleting = Boolean(state?.deleting?.[requirement.code]);

    card.className = options.cardClassName || 'application-document-card';
    card.id = `document-${requirement.code}`;
    card.dataset.documentCode = requirement.code;

    const children = [];
    const title = createTranslatedElement(document, 'h3', requirement.label_key, messages[requirement.label_key] || messages.documentNotUploaded);
    title.tabIndex = -1;
    const description = createTranslatedElement(
        document,
        'p',
        requirement.description_key || '',
        requirement.description_key ? (messages[requirement.description_key] || '') : ''
    );
    const statusKey = isDeleting ? 'deleteInProgress' : (task?.errorKey || getDocumentStatusKey(requirement, task));
    const status = createTranslatedElement(document, 'p', statusKey, messages[statusKey] || messages.documentNotUploaded);
    status.className = 'document-upload-status';
    if (options.statusId) status.id = options.statusId;
    const statusTone = typeof options.statusTone === 'function'
        ? options.statusTone(requirement, task, statusKey, isDeleting)
        : getDocumentStatusTone(requirement, task, statusKey, isDeleting);
    status.dataset.status = statusTone;
    if (statusTone !== 'pending') status.classList.add(`is-${statusTone}`);
    if (statusTone === 'error') {
        status.setAttribute('role', 'alert');
    } else {
        status.setAttribute('aria-live', 'polite');
    }

    children.push(title, description, createRequirementBadge(document, requirement.required ?? requirement.is_required, messages), status);

    if (requirement.student_message) {
        const msgLabel = document.createElement('strong');
        msgLabel.className = 'tracking-document-message-label';
        msgLabel.textContent = messages.trackingDocumentMessageLabel;
        const msgBody = document.createElement('p');
        msgBody.className = 'tracking-document-message';
        msgBody.textContent = requirement.student_message;
        children.push(msgLabel, msgBody);
    }

    card.replaceChildren(...children);

    if (requirement.filename) appendFilename(document, card, `${messages.currentFile}: ${requirement.filename}`);
    if (requirement.filename && requirement.upload_status === 'finalized') {
        card.append(createDocumentPreviewLink(document, requirement.code, messages));
    }
    if (task?.file && task.state !== 'complete') appendFilename(document, card, `${messages.selectedReplacement}: ${task.file.name}`);
    const progress = createUploadProgress(document, task, messages);
    if (progress) card.append(progress);
    if (!allowUpload) return card;

    card.append(createFileInput(document, requirement, task, messages, {
        disabled: options.disabled,
        ariaInvalid: options.ariaInvalid,
        statusId: options.statusId
    }));
    if (task && RETRYABLE_UPLOAD_STATES.includes(task.state)) {
        const retryBtn = createButton(document, messages, 'retryUpload', 'document-retry');
        retryBtn.disabled = Boolean(options.disabled);
        card.append(retryBtn);
    }
    if (task && task.state === 'uploading') {
        const cancelBtn = createButton(document, messages, 'cancelUpload', 'document-cancel');
        cancelBtn.disabled = Boolean(options.disabled);
        card.append(cancelBtn);
    }
    if (allowDelete && (requirement.filename || requirement.cleanup_status === 'pending')) {
        const remove = createButton(document, messages, requirement.cleanup_status === 'pending' ? 'retryCleanup' : 'deleteDocument', 'document-delete');
        remove.disabled = Boolean(options.disabled) || isDeleting;
        card.append(remove);
    }
    return card;
}

export function createDocumentCard(document, requirement, state, options = {}) {
    const card = document.createElement('article');
    return populateDocumentCard(card, requirement, state, options);
}

export async function openRequirementDocumentComposer(document, requirement, { openPdfMergerModal: injectedModal, messages: providedMessages, onSaveFile } = {}) {
    const messages = providedMessages || readUploadCardMessages(document);
    const openPdfMergerModal = injectedModal || (await import('../ui/pdfMergerModal.js')).openPdfMergerModal;
    openPdfMergerModal({
        text: readPdfMergerMessages(document.documentElement.lang || 'tr'),
        studentMode: true,
        hideStopCapture: true,
        contextLabel: messages.documentPagesHelp,
        confirmLabel: messages.documentPagesConfirm,
        successMessage: messages.documentPagesUploaded,
        maxFiles: 30,
        onSave: async (bytes) => {
            const FileClass = document.defaultView?.File || File;
            const file = new FileClass([bytes], `${requirement.code}_sayfalar.pdf`, { type: 'application/pdf' });
            await onSaveFile(file);
        }
    });
}
