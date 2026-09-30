import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';
import { createDraftAutosave } from './draftAutosave.js';
import { isValidPhoneNumber } from '../shared/phoneNumber.js';

const STEP_KEYS = Object.freeze(['stepContact', 'stepResidence', 'stepDocuments', 'stepDeclaration', 'stepReview']);
const RESIDENCE_FIELDS = Object.freeze(['first_name', 'last_name', 'passport_number', 'nationality', 'date_of_birth']);
const UPLOAD_ERROR_KEYS = Object.freeze({
    FILE_TOO_LARGE: 'fileTooLarge', INVALID_FILE: 'invalidFileType', STORAGE_UNAVAILABLE: 'uploadIntentFailed',
    UPLOAD_CAPABILITY_EXPIRED: 'uploadCapabilityExpired', UPLOAD_NETWORK_ERROR: 'uploadNetworkFailed',
    UPLOAD_TIMEOUT: 'uploadNetworkFailed', R2_UPLOAD_FAILED: 'r2UploadFailed', UPLOAD_OBJECT_MISMATCH: 'finalizeFailed',
    UPLOAD_OBJECT_MISSING: 'uploadObjectMissing', UPLOAD_INTENT_EXPIRED: 'uploadIntentExpired',
    UPLOAD_INTENT_UNAVAILABLE: 'uploadIntentExpired', NETWORK_ERROR: 'finalizeUnknown',
    APPLICATION_SESSION_REQUIRED: 'sessionExpired', APPLICATION_NOT_EDITABLE: 'applicationNoLongerEditable',
    DOCUMENT_NOT_EDITABLE: 'applicationNoLongerEditable', DECLARATION_VERSION_CONFLICT: 'declarationVersionChanged',
    APPLICATION_TYPE_CHANGE_BLOCKED: 'applicationTypeChangeBlocked',
    CONTACT_ACKNOWLEDGEMENT_REQUIRED: 'contactAcknowledgementRequired',
    CONTACT_ACKNOWLEDGEMENT_VERSION_CONFLICT: 'contactAcknowledgementVersionChanged',
    CONTACT_INFORMATION_INCOMPLETE: 'contactInformationIncomplete',
    SUBMISSION_NOT_READY: 'submissionNotReady',
    APPLICATION_NOT_SUBMITTABLE: 'applicationSubmitFailed'
});

function readMessages(document) {
    const locale = document.documentElement.lang;
    const closeoutMessages = SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr;
    const publicMessages = PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr;
    return { ...closeoutMessages, ...publicMessages };
}

function createTranslatedElement(document, tag, key, text) {
    const element = document.createElement(tag);
    element.dataset.i18n = key;
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

function createTextField(document, { key, name, value, type = 'text', required = false, maxLength = 255 }) {
    const messages = readMessages(document);
    const label = document.createElement('label');
    const input = document.createElement('input');
    label.className = 'application-form-field';
    label.append(createTranslatedElement(document, 'span', key, messages[key]));
    input.type = type;
    input.name = name;
    input.value = value ?? '';
    input.required = required;
    if (type !== 'date') input.maxLength = maxLength;
    label.append(input);
    return label;
}

function createSelectField(document, { key, name, value, options, required = false }) {
    const messages = readMessages(document);
    const label = document.createElement('label');
    const select = document.createElement('select');
    label.className = 'application-form-field';
    label.append(createTranslatedElement(document, 'span', key, messages[key]));
    select.name = name;
    select.required = required;
    options.forEach(({ value: optionValue, key: optionKey, disabled = false }) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = messages[optionKey];
        option.dataset.i18n = optionKey;
        option.disabled = disabled;
        select.append(option);
    });
    select.value = value ?? '';
    label.append(select);
    return label;
}

function createWizardForm(document) {
    const form = document.createElement('form');
    form.id = 'application-step-form';
    return form;
}

function createContinueButton(document, messages) {
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'application-button application-button-primary';
    button.dataset.i18n = 'continue';
    button.textContent = messages.continue;
    return button;
}

function createContactAcknowledgement(document, messages, isAccepted) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'contact_acknowledgement_accepted';
    checkbox.required = true;
    checkbox.checked = isAccepted;
    label.className = 'contact-acknowledgement';
    label.append(checkbox, createTranslatedElement(document, 'span', 'contactResponsibilityAcknowledgement', messages.contactResponsibilityAcknowledgement));
    return label;
}

function canContinueContactStep(form) {
    setContactPhoneValidity(form);
    return Boolean(form?.checkValidity()
        && form.querySelector('[name="contact_acknowledgement_accepted"]')?.checked === true);
}

function setContactPhoneValidity(form) {
    const phone = form?.querySelector('[name="student_phone"]');
    if (!phone) return;
    const messages = readMessages(form.ownerDocument);
    phone.setCustomValidity(phone.value.trim() && !isValidPhoneNumber(phone.value) ? messages.contactPhoneInvalid : '');
}

function updateContactContinueButton(root) {
    const form = root.querySelector('#application-step-form');
    const button = form?.querySelector('button[type="submit"]');
    if (!form || !button) return;
    button.disabled = !canContinueContactStep(form);
}

function createContactStep(document, application, formValues) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    form.append(createTextField(document, { key: 'studentNumber', name: 'student_number', value: fields.student_number, required: true, maxLength: 64 }));
    form.append(createTextField(document, { key: 'email', name: 'student_email', type: 'email', value: fields.student_email, required: true, maxLength: 254 }));
    form.append(createTextField(document, { key: 'phone', name: 'student_phone', type: 'tel', value: fields.student_phone, required: true, maxLength: 40 }));
    form.append(createSelectField(document, {
        key: 'applicationType', name: 'application_type', value: fields.application_type, required: true,
        options: [{ value: '', key: 'applicationType' }, { value: 'initial', key: 'initialApplication' }, { value: 'renewal', key: 'renewalApplication' }]
    }));
    form.querySelector('[name="student_number"]').disabled = Boolean(application);
    form.querySelector('[name="application_type"]').disabled = Boolean(application && application.status !== 'draft');
    const isContactAcknowledgementAccepted = application?.contact_acknowledgement?.accepted_current === true
        || fields.contact_acknowledgement_accepted === true;
    form.append(createContactAcknowledgement(document, messages, isContactAcknowledgementAccepted));
    const continueButton = createContinueButton(document, messages);
    form.append(continueButton);
    setContactPhoneValidity(form);
    continueButton.disabled = !canContinueContactStep(form);
    return form;
}

function createFingerprintChoice(document, value, key, selected, messages) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'fingerprint_status';
    input.value = value;
    input.checked = selected === value;
    input.required = true;
    label.append(input, createTranslatedElement(document, 'span', key, messages[key]));
    return label;
}

/**
 * Renders separate fingerprint registration and code fields.
 * @param {HTMLElement} root Student wizard content container.
 * @param {object} application Student-safe application values.
 * @returns {HTMLElement} Rendered fingerprint fieldset.
 */
export function renderFingerprintSection(root, application) {
    const document = root.ownerDocument;
    const messages = readMessages(document);
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'application-fieldset fingerprint-fields';
    fieldset.append(createTranslatedElement(document, 'legend', 'fingerprintQuestion', messages.fingerprintQuestion));
    fieldset.append(
        createFingerprintChoice(document, 'registered', 'yes', application.fingerprint_status, messages),
        createFingerprintChoice(document, 'not_registered', 'no', application.fingerprint_status, messages)
    );
    if (application.fingerprint_status === 'registered') appendFingerprintCode(document, fieldset, application, messages);
    if (application.fingerprint_status === 'not_registered') {
        fieldset.append(createTranslatedElement(document, 'p', 'fingerprintNotRegisteredNotice', messages.fingerprintNotRegisteredNotice));
        const error = createTranslatedElement(document, 'p', 'fingerprintProgressBlocked', messages.fingerprintProgressBlocked);
        error.setAttribute('role', 'alert');
        fieldset.append(error);
    }
    root.append(fieldset);
    return fieldset;
}

function appendFingerprintCode(document, fieldset, application, messages) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'fingerprint_code';
    input.maxLength = 128;
    input.required = true;
    input.autocomplete = 'off';
    input.value = application.fingerprint_code || '';
    label.append(createTranslatedElement(document, 'span', 'fingerprintCodeLabel', messages.fingerprintCodeLabel), input);
    fieldset.append(label);
    if (!input.value.trim()) fieldset.append(createTranslatedElement(document, 'p', 'fingerprintCodeMissing', messages.fingerprintCodeMissing));
}

function createResidenceStep(document, application, formValues) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    RESIDENCE_FIELDS.forEach((field) => {
        const key = ({ first_name: 'firstName', last_name: 'lastName', passport_number: 'passportNumber', nationality: 'nationality', date_of_birth: 'dateOfBirth' })[field];
        form.append(createTextField(document, { key, name: field, value: fields[field], type: field === 'date_of_birth' ? 'date' : 'text', required: true }));
    });
    const under18 = application.is_under_18 === 1 || fields.is_under_18 === true
        ? 'true' : (application.is_under_18 === 0 || fields.is_under_18 === false ? 'false' : '');
    form.append(createSelectField(document, {
        key: 'under18Question', name: 'is_under_18', value: under18, required: true,
        options: [
            { value: '', key: 'under18SelectPlaceholder', disabled: true },
            { value: 'true', key: 'yes' },
            { value: 'false', key: 'no' }
        ]
    }));
    form.append(createAddressEvidenceChoices(document, fields, messages, Boolean(application && application.status !== 'draft')));
    renderFingerprintSection(form, fields);
    const continueButton = createContinueButton(document, messages);
    form.append(continueButton);
    continueButton.disabled = !canContinueResidenceStep(form, fields);
    return form;
}

function createAddressEvidenceChoices(document, fields, messages, isDisabled) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'application-fieldset address-evidence-fields';
    fieldset.append(createTranslatedElement(document, 'legend', 'addressEvidenceQuestion', messages.addressEvidenceQuestion));
    [
        ['rental_contract', 'addressEvidenceRentalContract'],
        ['residence_certificate', 'addressEvidenceResidenceCertificate'],
        ['undertaking', 'addressEvidenceUndertaking']
    ].forEach(([value, key]) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'address_evidence_type';
        input.value = value;
        input.required = true;
        input.disabled = isDisabled;
        input.checked = fields.address_evidence_type === value;
        label.append(input, createTranslatedElement(document, 'span', key, messages[key]));
        fieldset.append(label);
    });
    return fieldset;
}

function getDocumentStatusKey(requirement, task) {
    if (task?.state && task.state !== 'complete') return `uploadState_${task.state}`;
    if (requirement.cleanup_status === 'pending') return 'deleteCleanupPending';
    if (requirement.review_status === 'approved' || requirement.revision_status === 'approved') return 'documentApproved';
    if (requirement.review_status === 'under_review') return 'documentStaffReview';
    if (requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required') return 'documentNeedsReplacement';
    if (requirement.scan_status === 'pending') return 'documentPendingScan';
    if (requirement.upload_status === 'finalized') return 'uploadedWaitingReview';
    return 'documentNotUploaded';
}

function getDocumentStatusTone(requirement, task, statusKey, isDeleting) {
    if (isDeleting) return 'pending';
    if (statusKey === 'deleteCleanupPending' || statusKey === 'documentNeedsReplacement') return 'error';
    if (['failed_upload', 'failed_finalize', 'unknown_finalize_result'].includes(task?.state)) return 'error';
    if (task?.state === 'complete' || requirement.upload_status === 'finalized'
        || requirement.review_status === 'approved' || requirement.revision_status === 'approved') return 'success';
    return 'pending';
}

function createFilePolicyText(document, requirement, messages) {
    const types = requirement.accepted_media_types.join(', ');
    const size = (requirement.max_byte_size / (1024 * 1024)).toLocaleString(document.documentElement.lang);
    return messages.filePolicy.replace('{types}', types).replace('{size}', `${size} MB`);
}

function isFingerprintUploadEligible(application) {
    if (application?.fingerprint_status !== 'registered' || typeof application.fingerprint_code !== 'string') return false;
    const code = application.fingerprint_code.trim();
    return code.length > 0 && code.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(code);
}

function canContinueResidenceStep(form, fields) {
    return Boolean(form?.checkValidity() && isFingerprintUploadEligible(fields));
}

function getAddressEvidenceMessageKey(value) {
    if (value === 'rental_contract') return 'addressEvidenceRentalContract';
    if (value === 'residence_certificate') return 'addressEvidenceResidenceCertificate';
    if (value === 'undertaking') return 'addressEvidenceUndertaking';
    return null;
}

function updateResidenceContinueButton(root, fields) {
    const form = root.querySelector('#application-step-form');
    const button = form?.querySelector('button[type="submit"]');
    if (form && button) button.disabled = !canContinueResidenceStep(form, fields);
}

function createFileInput(document, requirement, task, messages) {
    const label = document.createElement('label');
    const textKey = requirement.filename ? 'replaceDocument' : 'uploadDocument';
    const text = createTranslatedElement(document, 'span', textKey, messages[textKey]);
    const input = document.createElement('input');
    const help = document.createElement('small');
    input.type = 'file';
    input.accept = requirement.accepted_media_types.join(',');
    input.dataset.documentCode = requirement.code;
    input.disabled = ['preparing', 'uploading', 'verifying'].includes(task?.state);
    help.textContent = createFilePolicyText(document, requirement, messages);
    label.className = 'application-upload-control';
    label.append(text, input, help);
    return label;
}

function createUploadProgress(document, task, messages) {
    if (!task || task.state !== 'uploading') return null;
    const wrapper = document.createElement('div');
    const progress = document.createElement('progress');
    const label = createTranslatedElement(document, 'span', 'uploadProgress', messages.uploadProgress.replace('{percent}', String(task.progress || 0)));
    label.dataset.progressLabel = 'true';
    progress.max = 100;
    progress.value = task.progress || 0;
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(task.progress || 0));
    progress.setAttribute('aria-label', messages.uploadProgress.replace('{percent}', String(task.progress || 0)));
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.append(progress, label);
    return wrapper;
}

function createDocumentCard(document, requirement, state, { allowUpload }) {
    const messages = readMessages(document);
    const task = state.uploads[requirement.code];
    const card = document.createElement('article');
    const title = createTranslatedElement(document, 'h3', requirement.label_key, messages[requirement.label_key] || messages.documentNotUploaded);
    const description = createTranslatedElement(document, 'p', requirement.description_key, messages[requirement.description_key] || '');
    const statusKey = state.deleting[requirement.code] ? 'deleteInProgress' : (task?.errorKey || getDocumentStatusKey(requirement, task));
    const status = createTranslatedElement(document, 'p', statusKey, messages[statusKey] || messages.documentNotUploaded);
    card.className = 'application-document-card';
    card.dataset.documentCode = requirement.code;
    status.className = 'document-upload-status';
    const statusTone = getDocumentStatusTone(requirement, task, statusKey, Boolean(state.deleting[requirement.code]));
    status.dataset.status = statusTone;
    if (statusTone !== 'pending') status.classList.add(`is-${statusTone}`);
    status.setAttribute('aria-live', 'polite');
    card.append(title, description, createRequirementBadge(document, requirement.required ?? requirement.is_required, messages), status);
    if (requirement.filename) appendFilename(document, card, `${messages.currentFile}: ${requirement.filename}`);
    if (task?.file && task.state !== 'complete') appendFilename(document, card, `${messages.selectedReplacement}: ${task.file.name}`);
    const progress = createUploadProgress(document, task, messages);
    if (progress) card.append(progress);
    if (!allowUpload) return card;
    card.append(createFileInput(document, requirement, task, messages));
    if (task && ['failed_upload', 'failed_finalize', 'unknown_finalize_result', 'cancelled'].includes(task.state)) {
        card.append(createButton(document, messages, 'retryUpload', 'document-retry'));
    }
    if (task && task.state === 'uploading') {
        card.append(createButton(document, messages, 'cancelUpload', 'document-cancel'));
    }
    if (requirement.filename || requirement.cleanup_status === 'pending') {
        const remove = createButton(document, messages, requirement.cleanup_status === 'pending' ? 'retryCleanup' : 'deleteDocument', 'document-delete');
        remove.disabled = state.deleting[requirement.code] === true;
        card.append(remove);
    }
    return card;
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

function createDocumentList(document, requirements, state, { allowUpload }) {
    const list = document.createElement('div');
    list.className = 'application-document-list';
    requirements.forEach((requirement) => list.append(createDocumentCard(document, requirement, state, { allowUpload })));
    return list;
}

/**
 * Renders server-provided safe requirement policy without a client policy map.
 * @param {HTMLElement} root Requirement list mount element.
 * @param {Array<object>} requirements Student-safe server policy rows.
 * @returns {void} Replaces the mount contents.
 */
export function renderStudentDocumentRequirements(root, requirements) {
    root.replaceChildren(createDocumentList(root.ownerDocument, requirements, { uploads: {}, deleting: {} }, { allowUpload: false }));
}

function createFingerprintReview(document, application) {
    const messages = readMessages(document);
    const section = document.createElement('section');
    const statusKey = application.fingerprint_status === 'registered'
        ? 'fingerprintRegistered' : (application.fingerprint_status === 'not_registered' ? 'fingerprintNotRegistered' : 'fingerprintUnanswered');
    section.className = 'application-review-section';
    section.append(createTranslatedElement(document, 'h3', 'reviewFingerprintHeading', messages.reviewFingerprintHeading));
    section.append(createTranslatedElement(document, 'p', statusKey, messages[statusKey]));
    if (application.fingerprint_status === 'registered' && application.fingerprint_code) {
        const code = document.createElement('code');
        code.textContent = application.fingerprint_code;
        section.append(code);
    }
    if (application.fingerprint_status === 'not_registered') {
        section.append(createTranslatedElement(document, 'p', 'fingerprintNotRegisteredNotice', messages.fingerprintNotRegisteredNotice));
    }
    return section;
}

function createDeclarationStep(document, application) {
    const messages = readMessages(document);
    const form = createWizardForm(document);
    const declaration = application.declaration || {};
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'declaration_accepted';
    checkbox.required = true;
    checkbox.checked = declaration.accepted_current === true;
    label.append(checkbox, createTranslatedElement(document, 'span', declaration.content_key || 'studentInformationAcknowledgement', messages[declaration.content_key] || messages.studentInformationAcknowledgement));
    form.append(label, createContinueButton(document, messages));
    if (declaration.accepted_current && declaration.accepted_at) {
        form.append(createTranslatedElement(document, 'p', 'declarationAccepted', messages.declarationAccepted));
    }
    return form;
}

function createApplicantReview(document, application) {
    const messages = readMessages(document);
    const values = [
        ['studentNumber', application.student_number], ['email', application.student_email], ['phone', application.student_phone],
        ['applicationType', application.application_type === 'renewal' ? messages.renewalApplication : messages.initialApplication],
        ['addressEvidenceTypeLabel', messages[getAddressEvidenceMessageKey(application.address_evidence_type)] || ''],
        ['firstName', application.first_name], ['lastName', application.last_name], ['passportNumber', application.passport_number],
        ['nationality', application.nationality], ['dateOfBirth', application.date_of_birth],
        ['under18Question', application.is_under_18 === true || application.is_under_18 === 1 ? messages.yes
            : (application.is_under_18 === false || application.is_under_18 === 0 ? messages.no : '')]
    ];
    const section = document.createElement('section');
    const list = document.createElement('dl');
    section.className = 'application-review-section';
    section.append(createTranslatedElement(document, 'h3', 'reviewApplicantHeading', messages.reviewApplicantHeading));
    values.forEach(([key, value]) => {
        const term = createTranslatedElement(document, 'dt', key, messages[key]);
        const detail = document.createElement('dd');
        detail.textContent = value ?? '';
        list.append(term, detail);
    });
    section.append(list);
    return section;
}

function createSubmissionConfirmation(document, application, messages) {
    const confirmation = document.createElement('section');
    confirmation.className = 'application-submission-confirmation';
    confirmation.setAttribute('role', 'status');
    confirmation.setAttribute('aria-live', 'polite');
    confirmation.append(createTranslatedElement(document, 'h3', 'submissionSuccessHeading', messages.submissionSuccessHeading));
    confirmation.append(createTranslatedElement(document, 'p', 'submissionStatusSubmitted', messages.submissionStatusSubmitted));
    const studentNumber = document.createElement('p');
    studentNumber.append(
        createTranslatedElement(document, 'span', 'submissionStudentNumber', messages.submissionStudentNumber),
        document.createTextNode(` ${application.student_number || ''}`)
    );
    confirmation.append(studentNumber);
    confirmation.append(createTranslatedElement(document, 'p', 'submissionTracking', messages.submissionTracking));
    if (application.submitted_at) confirmation.append(createSubmissionTime(document, application.submitted_at, messages));
    const trackingLink = document.createElement('a');
    trackingLink.href = '/basvurum/';
    trackingLink.className = 'application-button application-button-primary';
    trackingLink.dataset.i18n = 'trackingViewAction';
    trackingLink.textContent = messages.trackingViewAction;
    confirmation.append(trackingLink);
    return confirmation;
}

function createSubmissionTime(document, submittedAt, messages) {
    const time = document.createElement('p');
    time.append(
        createTranslatedElement(document, 'span', 'submissionSubmittedAt', messages.submissionSubmittedAt),
        document.createTextNode(` ${submittedAt}`)
    );
    return time;
}

function createReviewStep(document, state) {
    const messages = readMessages(document);
    const review = document.createElement('div');
    const application = state.application;
    review.className = 'application-review';
    review.append(createTranslatedElement(document, 'p', 'reviewHeading', messages.reviewHeading));
    review.append(createApplicantReview(document, application));
    review.append(createFingerprintReview(document, application));
    review.append(createDocumentList(document, state.requirements, state, { allowUpload: false }));
    const accepted = application.declaration?.accepted_current === true;
    review.append(createTranslatedElement(document, 'p', accepted ? 'declarationAccepted' : 'declarationRequired', messages[accepted ? 'declarationAccepted' : 'declarationRequired']));
    if (accepted && application.declaration.accepted_at) {
        const time = document.createElement('p');
        time.append(createTranslatedElement(document, 'span', 'declarationAcceptedAt', messages.declarationAcceptedAt), document.createTextNode(` ${application.declaration.accepted_at}`));
        review.append(time);
    }
    if (application.status === 'submitted') {
        review.append(createSubmissionConfirmation(document, application, messages));
        return review;
    }
    const submitButton = createButton(
        document,
        messages,
        state.isSubmitting ? 'submissionInProgress' : 'submitApplication',
        'submit-application',
        'application-button application-button-primary'
    );
    submitButton.disabled = state.isSubmitting;
    review.append(submitButton);
    return review;
}

function createSaveStatus(document, state) {
    const messages = readMessages(document);
    const key = state.saveStatus === 'session_expired' ? 'sessionExpired'
        : (state.saveStatus === 'failed' ? 'autosaveFailed' : `autosave_${state.saveStatus}`);
    const status = createTranslatedElement(document, 'p', key, messages[key] || messages.autosave_saved);
    status.dataset.saveStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (state.saveStatus === 'failed') status.append(createButton(document, messages, 'retrySave', 'autosave-retry'));
    return status;
}

function createProgress(document, step) {
    const list = document.createElement('ol');
    list.className = 'application-progress';
    STEP_KEYS.forEach((key, index) => {
        const item = document.createElement('li');
        const messages = readMessages(document);
        item.className = index === step ? 'is-current' : (index < step ? 'is-complete' : '');
        item.append(createTranslatedElement(document, 'span', key, messages[key]));
        list.append(item);
    });
    return list;
}

function renderWizard(root, state) {
    const document = root.ownerDocument;
    const messages = readMessages(document);
    const panel = document.createElement('div');
    const stage = document.createElement('section');
    panel.className = 'application-wizard';
    panel.append(createProgress(document, state.step), createTranslatedElement(document, 'h2', STEP_KEYS[state.step], messages[STEP_KEYS[state.step]]));
    panel.append(createSaveStatus(document, state));
    if (state.errorKey) {
        const error = createTranslatedElement(document, 'p', state.errorKey, messages[state.errorKey]);
        error.setAttribute('role', 'alert');
        panel.append(error);
    }
    if (state.step === 0) stage.append(createContactStep(document, state.application, state.formValues));
    if (state.step === 1) stage.append(createResidenceStep(document, state.application, state.formValues));
    if (state.step === 2) stage.append(createDocumentsStep(document, state));
    if (state.step === 3) stage.append(createDeclarationStep(document, state.application));
    if (state.step === 4) stage.append(createReviewStep(document, state));
    if (state.step > 0 && state.application?.status !== 'submitted') panel.append(createButton(document, messages, 'previous', 'previous'));
    panel.append(stage);
    root.replaceChildren(panel);
}

function updateDocumentCard(root, state, code) {
    const existing = [...root.querySelectorAll('.application-document-card')]
        .find((card) => card.dataset.documentCode === code);
    const requirement = state.requirements.find((entry) => entry.code === code);
    if (!existing || !requirement || state.step !== 2) {
        renderWizard(root, state);
        return;
    }
    const document = root.ownerDocument;
    const activeElement = document.activeElement;
    const action = activeElement?.closest('.application-document-card') === existing
        ? (activeElement.dataset.action ? `[data-action="${activeElement.dataset.action}"]` : 'input[type="file"]')
        : null;
    const replacement = createDocumentCard(document, requirement, state, { allowUpload: true });
    existing.replaceWith(replacement);
    if (action) replacement.querySelector(action)?.focus({ preventScroll: true });
}

function updateProgress(root, code, task) {
    const card = [...root.querySelectorAll('.application-document-card')]
        .find((entry) => entry.dataset.documentCode === code);
    const progress = card?.querySelector('progress');
    const messages = readMessages(root.ownerDocument);
    if (!progress) return;
    const percent = task.progress || 0;
    const label = messages.uploadProgress.replace('{percent}', String(percent));
    progress.value = percent;
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-label', label);
    const progressLabel = card.querySelector('[data-progress-label]');
    if (progressLabel) progressLabel.textContent = label;
}

function createDocumentsStep(document, state) {
    const messages = readMessages(document);
    const form = createWizardForm(document);
    form.append(createDocumentList(document, state.requirements, state, { allowUpload: true }));
    form.append(createContinueButton(document, messages));
    return form;
}

function readVisibleFields(root, application = {}) {
    const fields = { ...application };
    root.querySelectorAll('[name]').forEach((input) => {
        if (input.type === 'radio') {
            if (input.checked) fields[input.name] = input.value;
            return;
        }
        if (input.name === 'is_under_18') {
            fields.is_under_18 = input.value === '' ? null : input.value === 'true';
            return;
        }
        fields[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return fields;
}

function buildAutosaveValues(fields) {
    const values = {
        application_type: fields.application_type ?? 'initial',
        address_evidence_type: fields.address_evidence_type ?? null,
        student_email: fields.student_email ?? '',
        student_phone: fields.student_phone ?? '',
        is_under_18: fields.is_under_18 === true || fields.is_under_18 === 1 ? true
            : (fields.is_under_18 === false || fields.is_under_18 === 0 ? false : null),
        fingerprint_status: fields.fingerprint_status ?? null,
        fingerprint_code: fields.fingerprint_status === 'registered' ? (fields.fingerprint_code ?? '') : null
    };
    RESIDENCE_FIELDS.forEach((field) => { values[field] = fields[field] ?? ''; });
    return values;
}

function createAutosaveValuesFromApplication(application) {
    if (!application) return {};
    return buildAutosaveValues({
        ...application,
        is_under_18: application.is_under_18 === 1 ? true : (application.is_under_18 === 0 ? false : null)
    });
}

function createAutosave(state, api, root) {
    const save = api.autosaveCurrentApplication || api.updateCurrentApplication;
    return createDraftAutosave({
        initialValues: createAutosaveValuesFromApplication(state.application),
        save,
        onSaved: (application) => { state.application = application; state.sessionExpired = false; },
        onStatus: (status) => {
            state.saveStatus = state.sessionExpired ? 'session_expired' : status;
            const node = root.querySelector('[data-save-status]');
            if (node) {
                const messages = readMessages(root.ownerDocument);
                const key = status === 'failed' ? 'autosaveFailed' : `autosave_${status}`;
                node.dataset.i18n = key;
                node.textContent = messages[key] || messages.autosave_saved;
                if (status === 'failed' && !node.querySelector('[data-action="autosave-retry"]')) {
                    node.append(createButton(root.ownerDocument, messages, 'retrySave', 'autosave-retry'));
                }
                if (status !== 'failed') node.querySelector('[data-action="autosave-retry"]')?.remove();
            }
        },
        onError: (error) => {
            if (error.code === 'APPLICATION_SESSION_REQUIRED') state.sessionExpired = true;
        }
    });
}

function createContactDraft(fields) {
    return { student_number: fields.student_number, application_type: fields.application_type, email: fields.student_email, phone: fields.student_phone };
}

function scheduleCurrentFields(root, state) {
    if (!state.autosave) return;
    state.formValues = readVisibleFields(root, state.application);
    state.autosave.schedule(buildAutosaveValues(state.formValues));
}

function createErrorKey(error, fallback) {
    return UPLOAD_ERROR_KEYS[error.code] || fallback;
}

async function refreshRequirements(state, api) {
    const result = await api.readCurrentStudentDocumentRequirements();
    state.requirements = result.requirements;
}

async function persistRequirementSelection(root, state, api) {
    if (!state.application || !state.autosave) return;
    if (!await state.autosave.flush()) return;
    try {
        await refreshRequirements(state, api);
    } catch {
        state.errorKey = 'applicationLoadFailed';
    }
}

async function finalizeTask(code, task, state, api, root) {
    task.state = 'verifying';
    updateDocumentCard(root, state, code);
    try {
        await api.finalizeStudentDocumentUpload(task.intentId);
        await refreshRequirements(state, api);
        task.state = 'complete';
        task.file = null;
        task.intentId = null;
        updateDocumentCard(root, state, code);
    } catch (error) {
        if (['UPLOAD_OBJECT_MISSING', 'UPLOAD_INTENT_EXPIRED', 'UPLOAD_INTENT_UNAVAILABLE'].includes(error.code)) {
            task.state = 'failed_upload';
            task.errorKey = createErrorKey(error, 'uploadIntentExpired');
            task.intentId = null;
            return 'unavailable';
        }
        task.state = error.code === 'NETWORK_ERROR' || error.status >= 500 ? 'unknown_finalize_result' : 'failed_finalize';
        task.errorKey = createErrorKey(error, 'finalizeFailed');
        updateDocumentCard(root, state, code);
        return 'failed';
    }
    return 'complete';
}

async function runUploadTask(code, task, state, api, root, { isRetry = false } = {}) {
    if (['preparing', 'uploading', 'verifying'].includes(task.state)) return;
    task.errorKey = null;
    if (task.intentId) {
        const outcome = await finalizeTask(code, task, state, api, root);
        if (outcome !== 'unavailable') {
            updateDocumentCard(root, state, code);
            return;
        }
        if (!task.file) return;
    }
    if (!task.file) {
        task.state = 'failed_upload';
        task.errorKey = 'reselectFile';
        updateDocumentCard(root, state, code);
        return;
    }
    task.state = 'preparing';
    task.progress = 0;
    updateDocumentCard(root, state, code);
    let upload;
    try {
        ({ upload } = await api.createStudentDocumentUploadIntent(code, task.file));
    } catch (error) {
        task.state = 'failed_upload';
        task.errorKey = createErrorKey(error, 'uploadIntentFailed');
        updateDocumentCard(root, state, code);
        return;
    }
    task.intentId = upload.intent_id;
    task.state = 'uploading';
    task.abortController = new AbortController();
    updateDocumentCard(root, state, code);
    try {
        await api.putStudentDocumentDirect(upload, task.file, {
            signal: task.abortController.signal,
            onProgress: (progress) => {
                task.progress = progress;
                updateProgress(root, code, task);
            }
        });
    } catch (error) {
        task.state = error.code === 'UPLOAD_CANCELLED' ? 'cancelled' : 'failed_upload';
        task.errorKey = createErrorKey(error, 'r2UploadFailed');
        task.abortController = null;
        updateDocumentCard(root, state, code);
        return;
    }
    task.abortController = null;
    task.state = 'verifying';
    renderWizard(root, state);
    const result = await finalizeTask(code, task, state, api, root);
    if (result === 'failed' && isRetry) task.errorKey = createErrorKey({ code: 'NETWORK_ERROR' }, 'finalizeUnknown');
    updateDocumentCard(root, state, code);
}

async function handleFileSelection(root, state, api, input) {
    const file = input.files?.[0];
    if (!file) return;
    const code = input.dataset.documentCode;
    state.uploads[code] = { state: 'selected', progress: 0, file, intentId: null, abortController: null };
    updateDocumentCard(root, state, code);
    await runUploadTask(code, state.uploads[code], state, api, root);
}

async function handleDelete(root, state, api, code) {
    state.deleting[code] = true;
    updateDocumentCard(root, state, code);
    try {
        await api.deleteStudentDocument(code);
        await refreshRequirements(state, api);
        state.errorKey = null;
    } catch (error) {
        state.errorKey = createErrorKey(error, 'deleteFailed');
    } finally {
        state.deleting[code] = false;
        updateDocumentCard(root, state, code);
    }
}

async function saveStep(root, state, api) {
    if (state.isAdvancing) return;
    const form = root.querySelector('#application-step-form');
    if (state.step === 0) setContactPhoneValidity(form);
    if (form && !form.reportValidity()) return;
    const fields = readVisibleFields(root, state.application || {});
    if (state.step === 0 && !canContinueContactStep(form)) return;
    state.formValues = fields;
    state.errorKey = null;
    state.isAdvancing = true;
    try {
        if (state.step === 0 && !state.application) {
            state.application = await api.createApplicationDraft(createContactDraft(fields));
            state.autosave = createAutosave(state, api, root);
        } else if (state.application && state.step <= 1) {
            state.autosave.schedule(buildAutosaveValues(fields));
            if (!await state.autosave.flush()) throw Object.assign(new Error('Autosave failed.'), { code: 'AUTOSAVE_FAILED' });
        }
        if (state.step === 0 && !state.application.contact_acknowledgement?.accepted_current) {
            const version = state.application.contact_acknowledgement?.current_version;
            if (!version) throw Object.assign(new Error('Contact acknowledgement version is unavailable.'), { code: 'CONTACT_ACKNOWLEDGEMENT_VERSION_CONFLICT' });
            state.application = await api.acceptCurrentContactAcknowledgement(version);
            if (!state.application.contact_acknowledgement?.accepted_current) {
                throw Object.assign(new Error('Contact acknowledgement was not confirmed.'), { code: 'CONTACT_ACKNOWLEDGEMENT_REQUIRED' });
            }
        }
        if (state.step === 1 && !canContinueResidenceStep(form, state.application)) {
            state.errorKey = null;
            return;
        }
        if (state.step === 0 || state.step === 1 || state.step === 2) await refreshRequirements(state, api);
        if (state.step === 3) {
            const declaration = state.application.declaration;
            const accepted = fields.declaration_accepted === true;
            if (!declaration?.accepted_current) {
                if (!accepted) throw Object.assign(new Error('Declaration acceptance is required.'), { code: 'DECLARATION_ACCEPTANCE_REQUIRED' });
                state.application = await api.acceptCurrentApplicationDeclaration(declaration.current_version);
            }
        }
        state.step = Math.min(state.step + 1, STEP_KEYS.length - 1);
        state.formValues = null;
    } catch (error) {
        state.errorKey = createErrorKey(error, error.code === 'DECLARATION_ACCEPTANCE_REQUIRED' ? 'declarationAcceptanceFailed' : 'applicationSaveFailed');
        if (error.code === 'DECLARATION_VERSION_CONFLICT') {
            try {
                state.application = await api.readCurrentApplication();
            } catch {
                state.errorKey = 'applicationLoadFailed';
            }
        }
        if (error.code === 'APPLICATION_SESSION_REQUIRED') state.saveStatus = 'session_expired';
    } finally {
        state.isAdvancing = false;
        renderWizard(root, state);
    }
}

async function handlePrevious(root, state) {
    if (state.isAdvancing) return;
    if (state.step <= 0) return;
    if (state.step === 1 && state.autosave) {
        scheduleCurrentFields(root, state);
        state.isAdvancing = true;
        const saved = await state.autosave.flush();
        state.isAdvancing = false;
        if (!saved) {
            state.errorKey = 'autosaveFailed';
            renderWizard(root, state);
            return;
        }
    }
    state.formValues = readVisibleFields(root, state.application || {});
    state.step -= 1;
    state.errorKey = null;
    renderWizard(root, state);
}

async function handleWizardClick(root, state, api, event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const code = button.closest('[data-document-code]')?.dataset.documentCode;
    if (button.dataset.action === 'previous') await handlePrevious(root, state);
    if (button.dataset.action === 'submit-application') await submitApplication(root, state, api);
    if (button.dataset.action === 'document-retry' && code) await runUploadTask(code, state.uploads[code], state, api, root, { isRetry: true });
    if (button.dataset.action === 'document-delete' && code) await handleDelete(root, state, api, code);
    if (button.dataset.action === 'document-cancel' && code) state.uploads[code]?.abortController?.abort();
    if (button.dataset.action === 'autosave-retry' && state.autosave) {
        const saved = await state.autosave.flush();
        state.errorKey = saved ? null : 'autosaveFailed';
        renderWizard(root, state);
    }
}

async function submitApplication(root, state, api) {
    if (state.isSubmitting || state.application?.status !== 'draft') return;
    state.isSubmitting = true;
    state.errorKey = null;
    renderWizard(root, state);
    try {
        state.application = await api.submitCurrentApplication();
        state.errorKey = null;
    } catch (error) {
        state.errorKey = createErrorKey(error, 'applicationSubmitFailed');
        if (error.code === 'APPLICATION_SESSION_REQUIRED') state.saveStatus = 'session_expired';
    } finally {
        state.isSubmitting = false;
        renderWizard(root, state);
    }
}

function handleWizardInput(root, state) {
    if (state.step === 0) {
        state.formValues = readVisibleFields(root, state.application || {});
        if (state.application && state.autosave) scheduleCurrentFields(root, state);
        updateContactContinueButton(root);
        return;
    }
    if (state.application && state.step <= 1 && state.autosave) scheduleCurrentFields(root, state);
    if (state.step === 1) updateResidenceContinueButton(root, readVisibleFields(root, state.application || {}));
}

function handleWizardChange(root, state, api, event) {
    const input = event.target;
    if (input instanceof root.ownerDocument.defaultView.HTMLInputElement && input.type === 'file') {
        void handleFileSelection(root, state, api, input);
        return;
    }
    if (input.name === 'fingerprint_status') {
        scheduleCurrentFields(root, state);
        const fields = readVisibleFields(root, state.application || {});
        fields.fingerprint_code = fields.fingerprint_status === 'registered' ? fields.fingerprint_code || null : null;
        state.formValues = fields;
        state.errorKey = null;
        renderWizard(root, state);
        return;
    }
    handleWizardInput(root, state);
    if (['application_type', 'address_evidence_type'].includes(input.name)) {
        state.errorKey = null;
        void persistRequirementSelection(root, state, api);
    }
}

/**
 * Starts or resumes the public application wizard through the current owner session.
 * @param {HTMLElement} root Wizard mount element.
 * @param {object} api Application API functions, overridable in tests.
 * @returns {Promise<object>} Live wizard state.
 * @throws {TypeError} When the wizard mount element is missing.
 */
export async function initializeApplicationWizard(root, api) {
    if (!root || !root.ownerDocument) throw new TypeError('An application wizard root is required.');
    const state = { application: null, requirements: [], step: 0, errorKey: null, saveStatus: 'saved', isAdvancing: false, isSubmitting: false, formValues: null, uploads: {}, deleting: {} };
    root.addEventListener('submit', (event) => {
        if (event.target.id !== 'application-step-form') return;
        event.preventDefault();
        void saveStep(root, state, api);
    });
    root.addEventListener('input', () => handleWizardInput(root, state));
    root.addEventListener('change', (event) => handleWizardChange(root, state, api, event));
    root.addEventListener('click', (event) => { void handleWizardClick(root, state, api, event); });
    root.ownerDocument.addEventListener('public:locale-changed', () => renderWizard(root, state));
    try {
        state.application = await api.readCurrentApplication();
        state.step = state.application.status === 'submitted' ? 4
            : (state.application.contact_acknowledgement?.accepted_current === true ? 1 : 0);
        state.autosave = createAutosave(state, api, root);
        await refreshRequirements(state, api);
    } catch (error) {
        state.errorKey = error.code === 'APPLICATION_SESSION_REQUIRED' ? null : 'applicationLoadFailed';
    }
    renderWizard(root, state);
    return state;
}
