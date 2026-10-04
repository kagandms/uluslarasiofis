import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';
import { createDraftAutosave } from './draftAutosave.js';
import { createNotificationPreferenceField, parseNotificationPreferences, WHATSAPP_CONSENT_VERSION } from './notificationPreferences.js';
import { createPhoneField } from './phoneField.js';
import { createNationalityField } from './nationalityField.js';
import { PILOT_UX_MESSAGES } from './i18n/pilotUxMessages.js';
import { isValidPhoneNumber } from '../shared/phoneNumber.js';
import { calculateCurrentUnder18 } from '../shared/age.js';

const STEP_KEYS = Object.freeze(['stepContact', 'stepResidence', 'stepDocuments', 'stepDeclaration', 'stepReview']);
const RESIDENCE_FIELDS = Object.freeze(['first_name', 'last_name', 'passport_number', 'nationality', 'date_of_birth']);
const CONTACT_DRAFT_KEY = 'portal_draft_contact_fields';

function getDraftStorage(view) {
    try {
        if (view?.localStorage) return view.localStorage;
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        return null;
    }
    return null;
}

function saveContactDraftFields(view, fields) {
    const storage = getDraftStorage(view);
    if (!storage || !fields) return;
    try {
        const payload = {
            student_number: fields.student_number || '',
            student_email: fields.student_email || '',
            student_phone: fields.student_phone || '',
            phone_country: fields.phone_country || '',
            application_type: fields.application_type || '',
            whatsapp_opt_in: Boolean(fields.whatsapp_opt_in),
            contact_acknowledgement_accepted: Boolean(fields.contact_acknowledgement_accepted)
        };
        storage.setItem(CONTACT_DRAFT_KEY, JSON.stringify(payload));
    } catch {
        // Storage might be unavailable or restricted
    }
}

function loadContactDraftFields(view) {
    const storage = getDraftStorage(view);
    if (!storage) return null;
    try {
        const raw = storage.getItem(CONTACT_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
        return null;
    }
}

function clearContactDraftFields(view) {
    const storage = getDraftStorage(view);
    if (!storage) return;
    try {
        storage.removeItem(CONTACT_DRAFT_KEY);
    } catch {
        // Ignore
    }
}

const UPLOAD_ERROR_KEYS = Object.freeze({
    FILE_TOO_LARGE: 'fileTooLarge', INVALID_FILE: 'invalidFileType', STORAGE_UNAVAILABLE: 'uploadIntentFailed',
    UPLOAD_CAPABILITY_EXPIRED: 'uploadCapabilityExpired', UPLOAD_NETWORK_ERROR: 'uploadNetworkFailed',
    UPLOAD_TIMEOUT: 'uploadNetworkFailed', R2_UPLOAD_FAILED: 'r2UploadFailed', UPLOAD_OBJECT_MISMATCH: 'finalizeFailed',
    UPLOAD_OBJECT_MISSING: 'uploadObjectMissing', UPLOAD_INTENT_EXPIRED: 'uploadIntentExpired',
    UPLOAD_INTENT_UNAVAILABLE: 'uploadIntentExpired', NETWORK_ERROR: 'finalizeUnknown',
    APPLICATION_SESSION_REQUIRED: 'sessionExpired', APPLICATION_NOT_EDITABLE: 'applicationNoLongerEditable',
    DOCUMENT_NOT_EDITABLE: 'applicationNoLongerEditable', DECLARATION_VERSION_CONFLICT: 'declarationVersionChanged',
    APPLICATION_TYPE_CHANGE_BLOCKED: 'applicationTypeChangeBlocked',
    APPLICATION_UPDATE_CONFLICT: 'applicationUpdateConflict',
    APPLICATION_ALREADY_ACTIVE: 'applicationAlreadyActive',
    RATE_LIMITED: 'applicationRateLimited',
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
    return { ...closeoutMessages, ...publicMessages, ...PILOT_UX_MESSAGES[locale] };
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
    const span = createTranslatedElement(document, 'span', key, messages[key]);
    label.append(span);
    if (required) {
        const mark = document.createElement('span');
        mark.className = 'field-required-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = ' *';
        label.append(mark);
        input.setAttribute('aria-required', 'true');
    }
    input.type = type;
    input.name = name;
    input.id = `field-${name}`;
    label.htmlFor = input.id;
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
    const span = createTranslatedElement(document, 'span', key, messages[key]);
    label.append(span);
    if (required) {
        const mark = document.createElement('span');
        mark.className = 'field-required-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = ' *';
        label.append(mark);
        select.setAttribute('aria-required', 'true');
    }
    select.name = name;
    select.id = `field-${name}`;
    label.htmlFor = select.id;
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
    checkbox.id = 'field-contact-acknowledgement';
    checkbox.required = true;
    checkbox.setAttribute('aria-required', 'true');
    checkbox.checked = isAccepted;
    label.htmlFor = checkbox.id;
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
    const phone = form?.querySelector('[data-phone-visible]');
    const canonical = form?.querySelector('[name="student_phone"]');
    if (!phone) return;
    const messages = readMessages(form.ownerDocument);
    const isInvalid = !phone.value.trim() || canonical?.dataset.phonePossible !== 'true';
    phone.setCustomValidity(isInvalid ? messages.contactPhoneInvalid : '');
    phone.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
}

function updateContactContinueButton(root) {
    const form = root.querySelector('#application-step-form');
    const button = form?.querySelector('button[type="submit"]');
    if (!form || !button) return;
    button.disabled = !canContinueContactStep(form);
}

function createContactStep(document, application, formValues, state, api) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    form.append(createTextField(document, { key: 'studentNumber', name: 'student_number', value: fields.student_number, required: true, maxLength: 64 }));
    form.append(createTextField(document, { key: 'email', name: 'student_email', type: 'email', value: fields.student_email, required: true, maxLength: 254 }));
    const phoneField = createPhoneField(document, {
        value: fields.student_phone || '', locale: document.documentElement.lang, messages, country: fields.phone_country || ''
    });
    form.append(phoneField);
    form.append(createSelectField(document, {
        key: 'applicationType', name: 'application_type', value: fields.application_type, required: true,
        options: [{ value: '', key: 'applicationType' }, { value: 'initial', key: 'initialApplication' }, { value: 'renewal', key: 'renewalApplication' }]
    }));
    form.querySelector('[name="student_number"]').disabled = Boolean(application && application.status !== 'draft');
    form.querySelector('[name="application_type"]').disabled = Boolean(application && application.status !== 'draft');
    const isContactAcknowledgementAccepted = application?.contact_acknowledgement?.accepted_current === true
        || fields.contact_acknowledgement_accepted === true;
    form.append(createContactAcknowledgement(document, messages, isContactAcknowledgementAccepted));
    const preferenceField = createNotificationPreferenceField(document, {
        application,
        initialPreference: state?.notificationPreference,
        formValues,
        api: api || state?.api,
        phoneInput: form.querySelector('[name="student_phone"]'),
        onPhoneLockChange: (isLocked) => {
            phoneField.querySelector('[data-phone-visible]').disabled = isLocked;
            phoneField.querySelector('[name="phone_country"]').disabled = isLocked;
        },
        persistPhone: async () => {
            const currentFields = readVisibleFields(form, state?.application || {});
            if (state?.autosave) {
                state.formValues = currentFields;
                state.autosave.schedule(buildAutosaveValues(currentFields));
                const saved = await state.autosave.flush();
                if (!saved) return { success: false, error: new Error('Autosave failed') };
            } else if (api?.updateCurrentApplication || api?.updateCurrentApplicationDraft) {
                const saveFn = api.updateCurrentApplication || api.updateCurrentApplicationDraft;
                state.application = await saveFn({ ...buildAutosaveValues(currentFields), lock_version: state.application?.lock_version });
            }
            return { success: true, application: state?.application };
        },
        onPreferenceChange: (checked) => {
            if (state) {
                if (!state.formValues) state.formValues = readVisibleFields(form, application || {});
                state.formValues.whatsapp_opt_in = checked;
            }
        }
    });
    form.append(preferenceField);
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
    input.id = `fingerprint-status-${value}`;
    label.htmlFor = input.id;
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
    input.id = 'field-fingerprint-code';
    label.htmlFor = input.id;
    input.maxLength = 128;
    input.required = true;
    input.autocomplete = 'off';
    input.value = application.fingerprint_code || '';
    label.append(createTranslatedElement(document, 'span', 'fingerprintCodeLabel', messages.fingerprintCodeLabel), input);
    fieldset.append(label);
    fieldset.append(createTranslatedElement(document, 'small', 'fingerprintCodeHelp', messages.fingerprintCodeHelp));
    if (!input.value.trim()) fieldset.append(createTranslatedElement(document, 'p', 'fingerprintCodeMissing', messages.fingerprintCodeMissing));
}

function createResidenceStep(document, application, formValues) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    RESIDENCE_FIELDS.forEach((field) => {
        if (field === 'nationality') {
            form.append(createNationalityField(document, {
                value: fields[field], locale: document.documentElement.lang, messages
            }));
            return;
        }
        const key = ({ first_name: 'firstName', last_name: 'lastName', passport_number: 'passportNumber', nationality: 'nationality', date_of_birth: 'dateOfBirth' })[field];
        form.append(createTextField(document, { key, name: field, value: fields[field], type: field === 'date_of_birth' ? 'date' : 'text', required: true }));
    });
    const under18 = calculateCurrentUnder18(fields.date_of_birth);
    const under18Field = createSelectField(document, {
        key: 'under18Question', name: 'is_under_18', value: under18 === null ? '' : String(under18), required: false,
        options: [
            { value: '', key: 'under18SelectPlaceholder', disabled: true },
            { value: 'true', key: 'yes' },
            { value: 'false', key: 'no' }
        ]
    });
    under18Field.querySelector('select').disabled = true;
    form.append(under18Field);
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
        input.id = `address-evidence-${value}`;
        label.htmlFor = input.id;
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
    if (requirement.scan_status === 'unsafe') return 'documentScanUnsafe';
    if (requirement.scan_status === 'failed') return 'documentScanFailed';
    if (requirement.review_status === 'approved' || requirement.revision_status === 'approved') return 'documentApproved';
    if (requirement.review_status === 'under_review') return 'documentStaffReview';
    if (requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required') return 'documentNeedsReplacement';
    if (requirement.scan_status === 'pending') return 'documentPendingScan';
    if (requirement.upload_status === 'finalized') return 'uploadedWaitingReview';
    return 'documentNotUploaded';
}

function getDocumentStatusTone(requirement, task, statusKey, isDeleting) {
    if (isDeleting) return 'pending';
    if (['deleteCleanupPending', 'documentNeedsReplacement', 'documentScanUnsafe', 'documentScanFailed'].includes(statusKey)) return 'error';
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
    input.id = `upload-${requirement.code}`;
    input.accept = requirement.accepted_media_types.join(',');
    input.dataset.documentCode = requirement.code;
    input.disabled = ['preparing', 'uploading', 'verifying'].includes(task?.state);
    help.id = `upload-help-${requirement.code}`;
    help.textContent = createFilePolicyText(document, requirement, messages);
    input.setAttribute('aria-describedby', help.id);
    label.htmlFor = input.id;
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
    title.tabIndex = -1;
    const description = createTranslatedElement(document, 'p', requirement.description_key, messages[requirement.description_key] || '');
    const statusKey = state.deleting[requirement.code] ? 'deleteInProgress' : (task?.errorKey || getDocumentStatusKey(requirement, task));
    const status = createTranslatedElement(document, 'p', statusKey, messages[statusKey] || messages.documentNotUploaded);
    card.className = 'application-document-card';
    card.id = `document-${requirement.code}`;
    card.dataset.documentCode = requirement.code;
    status.className = 'document-upload-status';
    const statusTone = getDocumentStatusTone(requirement, task, statusKey, Boolean(state.deleting[requirement.code]));
    status.dataset.status = statusTone;
    if (statusTone !== 'pending') status.classList.add(`is-${statusTone}`);
    if (statusTone === 'error') {
        status.setAttribute('role', 'alert');
    } else {
        status.setAttribute('aria-live', 'polite');
    }
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

function isRequiredRequirement(requirement) {
    return requirement.required === true || requirement.required === 1
        || requirement.is_required === true || requirement.is_required === 1;
}

function isUploadInFlight(task) {
    return ['selected', 'preparing', 'uploading', 'verifying', 'failed_upload', 'failed_finalize', 'unknown_finalize_result'].includes(task?.state);
}

function isFinalizedRequirementReady(requirement) {
    return requirement.upload_status === 'finalized'
        && Number.isInteger(requirement.revision_number)
        && ['submitted', 'approved'].includes(requirement.revision_status)
        && ['pending', 'clean'].includes(requirement.scan_status)
        && requirement.scan_status !== 'unsafe'
        && requirement.scan_status !== 'failed'
        && requirement.cleanup_status !== 'pending';
}

/** @param {Array<object>} requirements Current server document policy rows. @param {object} uploads Local upload tasks. @param {object} deleting Local delete operations. @returns {{requiredCount: number, uploadedCount: number, pending: Array<object>, canContinue: boolean}} */
export function calculateDocumentReadiness(requirements, uploads = {}, deleting = {}) {
    const required = requirements.filter(isRequiredRequirement);
    const pending = required.filter((requirement) => !isFinalizedRequirementReady(requirement)
        || isUploadInFlight(uploads[requirement.code]) || deleting[requirement.code] === true);
    return {
        requiredCount: required.length,
        uploadedCount: required.length - pending.length,
        pending,
        canContinue: pending.length === 0
    };
}

function renderDocumentReadiness(document, state) {
    const messages = readMessages(document);
    const readiness = calculateDocumentReadiness(state.requirements, state.uploads, state.deleting);
    const section = document.createElement('section');
    const summary = document.createElement('p');
    section.className = 'document-readiness-summary';
    section.dataset.documentReadiness = 'true';
    summary.textContent = messages.requiredDocumentProgress
        .replace('{required}', String(readiness.requiredCount))
        .replace('{uploaded}', String(readiness.uploadedCount));
    section.append(summary);
    if (readiness.pending.length) {
        section.append(createTranslatedElement(document, 'p', 'documentContinueBlocked', messages.documentContinueBlocked));
        const missing = document.createElement('ul');
        missing.setAttribute('aria-label', messages.missingRequiredDocuments);
        readiness.pending.forEach((requirement) => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = `#document-${requirement.code}`;
            link.dataset.action = 'focus-document';
            link.dataset.targetDocument = requirement.code;
            link.textContent = messages[requirement.label_key] || requirement.code;
            item.append(link);
            missing.append(item);
        });
        section.append(missing);
    }
    return { section, readiness };
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

function createDeclarationStep(document, application, state) {
    const messages = readMessages(document);
    const form = createWizardForm(document);
    const declaration = application.declaration || {};
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    label.className = 'declaration-label';
    checkbox.className = 'declaration-checkbox';
    checkbox.type = 'checkbox';
    checkbox.name = 'declaration_accepted';
    checkbox.id = 'field-declaration-accepted';
    label.htmlFor = checkbox.id;
    checkbox.required = true;
    checkbox.setAttribute('aria-required', 'true');
    checkbox.checked = declaration.accepted_current === true;
    label.append(checkbox, createTranslatedElement(document, 'span', declaration.content_key || 'studentInformationAcknowledgement', messages[declaration.content_key] || messages.studentInformationAcknowledgement));
    const continueButton = createContinueButton(document, messages);
    continueButton.disabled = state.isAdvancing || !checkbox.checked;
    form.append(label, continueButton);
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

export function createSubmissionConfirmation(document, application, messages) {
    const confirmation = document.createElement('section');
    confirmation.className = 'application-submission-confirmation';
    confirmation.tabIndex = -1;
    confirmation.setAttribute('role', 'status');
    confirmation.setAttribute('aria-live', 'polite');
    confirmation.append(createTranslatedElement(document, 'h3', 'submissionSuccessHeading', messages.submissionSuccessHeading));
    confirmation.append(createTranslatedElement(document, 'p', 'submissionStatusSubmitted', messages.submissionStatusSubmitted));
    if (application.reference_number) {
        const refElement = document.createElement('p');
        refElement.className = 'submission-reference-number';
        refElement.append(
            createTranslatedElement(document, 'strong', 'accessReferenceNumberLabel', messages.accessReferenceNumberLabel),
            document.createTextNode(`: ${application.reference_number}`)
        );
        confirmation.append(refElement);
        confirmation.append(createTranslatedElement(document, 'p', 'applicationReferencePurpose', messages.applicationReferencePurpose));
    }
    const studentNumber = document.createElement('p');
    studentNumber.append(
        createTranslatedElement(document, 'span', 'submissionStudentNumber', messages.submissionStudentNumber),
        document.createTextNode(` ${application.student_number || ''}`)
    );
    confirmation.append(studentNumber);
    const reminder = createTranslatedElement(document, 'p', 'submissionCredentialsReminder', messages.submissionCredentialsReminder);
    reminder.className = 'submission-credentials-reminder';
    confirmation.append(reminder);
    confirmation.append(createTranslatedElement(document, 'p', 'submissionTracking', messages.submissionTracking));
    const newApplicationLink = document.createElement('a');
    newApplicationLink.href = '/basvuru/?new=1';
    newApplicationLink.className = 'application-button application-button-secondary';
    newApplicationLink.dataset.i18n = 'submissionNewStudentApplicationAction';
    newApplicationLink.textContent = messages.submissionNewStudentApplicationAction;
    confirmation.append(newApplicationLink);
    if (application.submitted_at) confirmation.append(createSubmissionTime(document, application.submitted_at, messages));
    const trackingLink = document.createElement('a');
    trackingLink.href = '/basvurum/';
    trackingLink.className = 'application-button application-button-primary';
    trackingLink.dataset.i18n = 'trackingViewAction';
    trackingLink.textContent = messages.trackingViewAction;
    confirmation.append(trackingLink);
    return confirmation;
}

function createCredentialCopyStatus(document) {
    const status = document.createElement('p');
    status.className = 'credential-copy-status';
    status.dataset.copyStatus = 'true';
    status.hidden = true;
    status.setAttribute('role', 'status');
    return status;
}

async function copyCredentialValue(document, valueElement, button, value, messages) {
    const status = button.parentElement.querySelector('[data-copy-status]');
    try {
        await document.defaultView.navigator.clipboard.writeText(value);
        status.textContent = messages.copySuccess;
        button.textContent = messages.copySuccess;
    } catch {
        const selection = document.defaultView.getSelection();
        valueElement.focus();
        selection?.selectAllChildren(valueElement);
        status.textContent = messages.clipboardCopyFailed;
    }
    status.hidden = false;
}

function createReferenceBanner(document, state, messages) {
    const banner = document.createElement('aside');
    banner.className = 'application-credentials-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', messages.accessCredentialsHeading);

    const reference = state.application.reference_number;
    const refText = document.createElement('p');
    refText.className = 'credentials-banner-text';
    const refValue = document.createElement('code');
    refValue.className = 'credential-value credential-reference';
    refValue.tabIndex = 0;
    refValue.textContent = reference;
    refText.append(
        createTranslatedElement(document, 'strong', 'accessReferenceNumberLabel', messages.accessReferenceNumberLabel),
        document.createTextNode(': '), refValue
    );
    const copyButton = createButton(document, messages, 'copyAction', 'copy-reference', 'application-button application-button-secondary');
    copyButton.addEventListener('click', async () => {
        await copyCredentialValue(document, refValue, copyButton, reference, messages);
    });
    const purpose = createTranslatedElement(document, 'p', 'applicationReferencePurpose', messages.applicationReferencePurpose);
    banner.append(refText, copyButton, createCredentialCopyStatus(document), purpose);
    return banner;
}

function createResumeWithCredentialsSection(document, state, messages) {
    const card = document.createElement('section');
    card.className = 'application-resume-card';
    card.setAttribute('aria-label', messages.accessDeviceHeading);

    const title = createTranslatedElement(document, 'h3', 'accessDeviceHeading', messages.accessDeviceHeading);
    const explanation = createTranslatedElement(document, 'p', 'accessDeviceExplanation', messages.accessDeviceExplanation);

    const form = document.createElement('form');
    form.id = 'resume-application-form';
    form.className = 'application-form';

    const refLabel = document.createElement('label');
    refLabel.className = 'application-form-field';
    refLabel.htmlFor = 'resume-reference-number';
    refLabel.append(createTranslatedElement(document, 'span', 'applicationReferenceNumber', messages.applicationReferenceNumber));
    const refInput = document.createElement('input');
    refInput.type = 'text';
    refInput.id = 'resume-reference-number';
    refInput.name = 'resume_reference_number';
    refInput.placeholder = 'ITU-XXXX-XXXX';
    refInput.maxLength = 32;
    refInput.required = true;
    refInput.setAttribute('aria-required', 'true');
    refInput.autocomplete = 'off';
    refLabel.append(refInput);

    const numberLabel = document.createElement('label');
    numberLabel.className = 'application-form-field';
    numberLabel.htmlFor = 'resume-student-number';
    numberLabel.append(createTranslatedElement(document, 'span', 'studentNumber', messages.studentNumber));
    const numberInput = document.createElement('input');
    numberInput.type = 'text';
    numberInput.id = 'resume-student-number';
    numberInput.name = 'resume_student_number';
    numberInput.maxLength = 64;
    numberInput.required = true;
    numberInput.setAttribute('aria-required', 'true');
    numberInput.autocomplete = 'off';
    numberLabel.append(numberInput);

    const submitBtn = createButton(document, messages, 'accessDeviceSubmit', 'resume-submit', 'application-button application-button-secondary');
    submitBtn.type = 'submit';

    const feedback = document.createElement('p');
    feedback.className = 'application-message resume-feedback';
    feedback.setAttribute('role', 'alert');

    form.append(refLabel, numberLabel, submitBtn, feedback);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ref = refInput.value.trim();
        const studentNumber = numberInput.value.trim();
        if (!ref || !studentNumber) return;
        submitBtn.disabled = true;
        feedback.textContent = '';
        try {
            if (typeof state.api.accessApplicationWithReference !== 'function') {
                throw new Error('accessApplicationWithReference not supported');
            }
            await state.api.accessApplicationWithReference({
                reference_number: ref,
                student_number: studentNumber
            });
            state.application = await state.api.readCurrentApplication();
            if (state.application.status === 'resubmission_required') {
                state.redirectingToTracking = true;
                state.navigateToTracking('/basvurum/');
                renderWizard(state.root || document.querySelector('#application-wizard') || document.body, state);
                return;
            }
            state.step = state.application.status === 'submitted' ? 4
                : (state.application.contact_acknowledgement?.accepted_current === true ? 1 : 0);
            state.autosave = createAutosave(state, state.api, state.root || document.querySelector('#application-wizard') || document.body);
            await refreshRequirements(state, state.api);
            renderWizard(state.root || document.querySelector('#application-wizard') || document.body, state);
        } catch (error) {
            submitBtn.disabled = false;
            if (error?.status === 429 || error?.code === 'RATE_LIMITED') {
                feedback.textContent = messages.trackingLookupRateLimited;
            } else if (error?.status === 401 || error?.status === 404 || error?.code === 'INVALID_ACCESS_CREDENTIALS') {
                feedback.textContent = messages.accessInvalidCredentials;
            } else {
                feedback.textContent = messages.applicationLoadFailed;
            }
        }
    });

    card.append(title, explanation, form);
    return card;
}

function createSubmissionTime(document, submittedAt, messages) {
    const time = document.createElement('p');
    time.append(
        createTranslatedElement(document, 'span', 'submissionSubmittedAt', messages.submissionSubmittedAt),
        document.createTextNode(` ${formatSubmissionTime(submittedAt, document.documentElement.lang || 'tr')}`)
    );
    return time;
}

function formatSubmissionTime(submittedAt, locale) {
    const instant = new Date(submittedAt);
    if (!Number.isFinite(instant.getTime())) return submittedAt;
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Istanbul'
    }).format(instant);
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
        time.append(createTranslatedElement(document, 'span', 'declarationAcceptedAt', messages.declarationAcceptedAt),
            document.createTextNode(` ${formatSubmissionTime(application.declaration.accepted_at, document.documentElement.lang || 'tr')}`));
        review.append(time);
    }
    if (application.status === 'submitted') {
        review.append(createSubmissionConfirmation(document, application, messages));
        return review;
    }
    const readiness = renderReviewReadiness(document, state);
    if (readiness.section) {
        review.append(readiness.section);
    }
    const submitButton = createButton(
        document,
        messages,
        state.isSubmitting ? 'submissionInProgress' : 'submitApplication',
        'submit-application',
        'application-button application-button-primary'
    );
    submitButton.disabled = state.isSubmitting || !readiness.canSubmit;
    review.append(submitButton);
    return review;
}

function isReviewFieldValid(field, application) {
    const value = application[field];
    if (field === 'application_type') return ['initial', 'renewal'].includes(value);
    if (field === 'student_email') return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());
    if (field === 'student_phone') return isValidPhoneNumber(value) && value.trim().length <= 40;
    if (field === 'address_evidence_type') return ['rental_contract', 'residence_certificate', 'undertaking'].includes(value);
    if (field === 'date_of_birth') {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value && date.valueOf() <= Date.now();
    }
    if (field === 'student_number') return typeof value === 'string' && value.trim().length > 0 && value.length <= 64;
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 255;
}

/** @param {object} application Current owner application. @param {Array<object>} requirements Current server document requirements. @param {object} uploads Local upload tasks. @param {object} deleting Local delete operations. @returns {{canSubmit: boolean, issues: Array<{kind: string, step: number, code: string|null, messageKey: string|null}>}} */
export function getReviewReadiness(application, requirements, uploads = {}, deleting = {}) {
    const fields = [
        ['student_number', 'studentNumber', 0], ['student_email', 'email', 0], ['student_phone', 'phone', 0],
        ['application_type', 'applicationType', 0], ['address_evidence_type', 'addressEvidenceQuestion', 1],
        ['first_name', 'firstName', 1], ['last_name', 'lastName', 1], ['passport_number', 'passportNumber', 1],
        ['nationality', 'nationality', 1], ['date_of_birth', 'dateOfBirth', 1]
    ];
    const issues = fields.filter(([field]) => !isReviewFieldValid(field, application))
        .map(([, messageKey, step]) => ({ kind: 'field', step, code: null, messageKey }));
    if (!isFingerprintUploadEligible(application)) {
        issues.push({ kind: 'field', step: 1, code: null, messageKey: 'fingerprintQuestion' });
    }
    if (![0, 1, true, false].includes(application.is_under_18)) {
        issues.push({ kind: 'field', step: 1, code: null, messageKey: 'under18Question' });
    }
    if (application.contact_acknowledgement?.accepted_current !== true) {
        issues.push({ kind: 'field', step: 0, code: null, messageKey: 'contactResponsibilityAcknowledgement' });
    }
    if (!application.declaration?.accepted_current) issues.push({ kind: 'declaration', step: 3, code: null, messageKey: null });
    const documents = calculateDocumentReadiness(requirements, uploads, deleting);
    documents.pending.forEach((requirement) => issues.push({ kind: 'document', step: 2, code: requirement.code, messageKey: requirement.label_key }));
    return { canSubmit: issues.length === 0, issues };
}

function renderReviewReadiness(document, state) {
    const messages = readMessages(document);
    const readiness = getReviewReadiness(state.application, state.requirements, state.uploads, state.deleting);
    if (!readiness.issues.length) {
        return { section: null, canSubmit: true };
    }
    const section = document.createElement('section');
    section.className = 'review-readiness-summary';
    section.append(createTranslatedElement(document, 'h3', 'reviewReadinessHeading', messages.reviewReadinessHeading));
    const list = document.createElement('ul');
    readiness.issues.forEach((issue) => {
        const item = document.createElement('li');
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'review-readiness-link';
        link.dataset.action = 'go-step';
        link.dataset.step = String(issue.step);
        link.textContent = issue.kind === 'declaration' ? messages.reviewMissingDeclaration
            : issue.kind === 'document' ? `${messages[issue.messageKey] || issue.code} — ${messages.reviewDocumentsPending}`
                : messages.reviewMissingField.replace('{field}', messages[issue.messageKey] || issue.messageKey);
        item.append(link);
        list.append(item);
    });
    section.append(list);
    return { section, canSubmit: false };
}

function createSaveStatus(document, state) {
    const messages = readMessages(document);
    const key = state.saveStatus === 'session_expired' ? 'sessionExpired'
        : (state.saveStatus === 'failed' ? (state.application ? 'autosaveFailed' : 'draftSaveFailed')
            : `autosave_${state.saveStatus}`);
    const status = createTranslatedElement(document, 'p', key, messages[key] || messages.autosave_saved);
    status.dataset.saveStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = state.saveStatus === 'idle';
    if (state.saveStatus === 'failed' && state.application) {
        status.append(createButton(document, messages, 'retrySave', 'autosave-retry'));
    }
    return status;
}

function updateSaveStatus(root, state) {
    const status = root.querySelector('[data-save-status]');
    if (!status) return;
    const messages = readMessages(root.ownerDocument);
    const key = state.saveStatus === 'failed' ? (state.application ? 'autosaveFailed' : 'draftSaveFailed')
        : `autosave_${state.saveStatus}`;
    status.dataset.i18n = key;
    status.textContent = messages[key] || '';
    status.hidden = state.saveStatus === 'idle';
    if (state.saveStatus === 'failed' && state.application && !status.querySelector('[data-action="autosave-retry"]')) {
        status.append(createButton(root.ownerDocument, messages, 'retrySave', 'autosave-retry'));
    }
    if (state.saveStatus !== 'failed' || !state.application) status.querySelector('[data-action="autosave-retry"]')?.remove();
}

function createProgress(document, step) {
    const list = document.createElement('ol');
    list.className = 'application-progress';
    const messages = readMessages(document);
    list.setAttribute('aria-label', messages.stepperAriaLabel || 'Başvuru Adımları');
    STEP_KEYS.forEach((key, index) => {
        const item = document.createElement('li');
        item.className = index === step ? 'is-current' : (index < step ? 'is-complete' : '');
        if (index === step) {
            item.setAttribute('aria-current', 'step');
        }
        item.append(createTranslatedElement(document, 'span', key, messages[key]));
        list.append(item);
    });
    return list;
}

function createPreferenceWarningBanner(document, state, messages) {
    const banner = document.createElement('div');
    banner.className = 'application-notification-preference-banner';
    banner.setAttribute('role', state.preferenceWarning.status === 'failed' ? 'alert' : 'status');
    banner.setAttribute('aria-live', 'polite');
    if (state.preferenceWarning.status === 'failed') {
        const text = createTranslatedElement(document, 'p', 'whatsappDraftSavedPreferenceFailed', messages.whatsappDraftSavedPreferenceFailed);
        const retryBtn = createButton(
            document,
            messages,
            'whatsappRetryPreferenceAction',
            'preference-retry',
            'application-button application-button-secondary'
        );
        banner.append(text, retryBtn);
    } else if (state.preferenceWarning.status === 'saved') {
        const text = createTranslatedElement(document, 'p', 'whatsappPreferenceSaved', messages.whatsappPreferenceSaved);
        banner.append(text);
    }
    return banner;
}

function renderWizard(root, state) {
    const document = root.ownerDocument;
    const messages = readMessages(document);
    const panel = document.createElement('div');
    const stage = document.createElement('section');
    panel.className = 'application-wizard';
    if (state.redirectingToTracking) {
        const destination = document.createElement('section');
        const trackingLink = document.createElement('a');
        destination.className = 'application-tracking-redirect';
        trackingLink.href = '/basvurum/';
        trackingLink.className = 'application-button application-button-primary';
        trackingLink.textContent = messages.trackingViewAction;
        destination.append(
            createTranslatedElement(document, 'h2', 'trackingViewAction', messages.trackingViewAction),
            trackingLink
        );
        root.replaceChildren(destination);
        return;
    }
    if (state._animateNextRender) {
        panel.dataset.animate = 'true';
        state._animateNextRender = false;
    }
    const heading = createTranslatedElement(document, 'h2', STEP_KEYS[state.step], messages[STEP_KEYS[state.step]]);
    heading.tabIndex = -1;
    panel.append(createProgress(document, state.step), heading);
    panel.append(createSaveStatus(document, state));
    const referenceNumber = state.application?.reference_number || state.application?.access_credentials?.reference_number;
    if (state.application && state.application.status === 'draft' && referenceNumber) {
        if (!state.application.reference_number) state.application.reference_number = referenceNumber;
        panel.append(createReferenceBanner(document, state, messages));
    }
    if (state.preferenceWarning) {
        panel.append(createPreferenceWarningBanner(document, state, messages));
    }
    let errorElement = null;
    if (state.errorKey) {
        errorElement = createTranslatedElement(document, 'p', state.errorKey, messages[state.errorKey]);
        errorElement.setAttribute('role', 'alert');
        errorElement.tabIndex = -1;
        panel.append(errorElement);
    }
    state.root = root;
    if (state.step === 0) {
        stage.append(createContactStep(document, state.application, state.formValues, state, state.api));
        if (!state.application) {
            stage.append(createResumeWithCredentialsSection(document, state, messages));
        }
    }
    if (state.step === 1) stage.append(createResidenceStep(document, state.application, state.formValues));
    if (state.step === 2) stage.append(createDocumentsStep(document, state));
    if (state.step === 3) stage.append(createDeclarationStep(document, state.application, state));
    if (state.step === 4) stage.append(createReviewStep(document, state));
    if (state.step > 0 && state.application?.status !== 'submitted') panel.append(createButton(document, messages, 'previous', 'previous'));
    panel.append(stage);
    root.replaceChildren(panel);
    if (state._focusError && errorElement) {
        errorElement.focus();
        state._focusError = false;
    } else if (state._focusSubmissionConfirmation) {
        const confirmation = root.querySelector('.application-submission-confirmation');
        if (confirmation) {
            confirmation.focus();
            confirmation.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        }
        state._focusSubmissionConfirmation = false;
    } else if (state._focusStepHeading) {
        heading.focus();
        state._focusStepHeading = false;
    }
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
    updateDocumentReadiness(root, state);
    if (action) replacement.querySelector(action)?.focus({ preventScroll: true });
}

function hasInFlightUpload(state) {
    return Object.values(state.uploads).some((task) => ['selected', 'preparing', 'uploading', 'verifying'].includes(task?.state));
}

async function handleReturnHome(event, root, state) {
    const link = event.target.closest('[data-action="return-home"]');
    if (!link) return;
    event.preventDefault();
    if (state.homeNavigationPending) return;
    if (hasInFlightUpload(state)) {
        state.errorKey = 'publicHomeNavigationBlocked';
        state._focusError = true;
        renderWizard(root, state);
        return;
    }
    state.homeNavigationPending = true;
    if (state.autosave && ((state.step <= 1 && root.querySelector('#application-step-form')))) scheduleCurrentFields(root, state);
    if (state.autosave && !await state.autosave.flush()) {
        state.homeNavigationPending = false;
        state.errorKey = 'autosaveFailed';
        state._focusError = true;
        renderWizard(root, state);
        return;
    }
    state.navigateHome('/');
}

function updateProgress(root, code, task, state) {
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
    updateDocumentReadiness(root, state);
}

function createDocumentsStep(document, state) {
    const messages = readMessages(document);
    const form = createWizardForm(document);
    const { section: readiness, readiness: status } = renderDocumentReadiness(document, state);
    const continueButton = createContinueButton(document, messages);
    continueButton.disabled = !status.canContinue;
    form.append(readiness);
    form.append(createDocumentList(document, state.requirements, state, {
        allowUpload: state.application?.status === 'draft'
    }));
    form.append(continueButton);
    return form;
}

function updateDocumentReadiness(root, state) {
    const current = root.querySelector('[data-document-readiness]');
    if (!current) return;
    const { section, readiness } = renderDocumentReadiness(root.ownerDocument, state);
    current.replaceWith(section);
    const button = root.querySelector('#application-step-form button[type="submit"]');
    if (button) button.disabled = !readiness.canContinue;
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
        student_number: fields.student_number ?? '',
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
    const save = async (patch) => {
        const payload = {
            ...patch,
            lock_version: state.application?.lock_version
        };
        const saveFn = api.autosaveCurrentApplication || api.updateCurrentApplication;
        const application = await saveFn(payload);
        state.application = { ...state.application, lock_version: application.lock_version };
        return application;
    };
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
            if (error.code === 'APPLICATION_UPDATE_CONFLICT') {
                state.errorKey = 'applicationUpdateConflict';
                state._focusError = true;
                renderWizard(root, state);
            }
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
                updateProgress(root, code, task, state);
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
    if (state.application?.status !== 'draft') return;
    const file = input.files?.[0];
    if (!file) return;
    const code = input.dataset.documentCode;
    state.uploads[code] = { state: 'selected', progress: 0, file, intentId: null, abortController: null };
    updateDocumentCard(root, state, code);
    await runUploadTask(code, state.uploads[code], state, api, root);
}

async function handleDelete(root, state, api, code) {
    if (state.application?.status !== 'draft') return;
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
    if (state.step === 3 && fields.declaration_accepted !== true) return;
    if (state.step === 2 && !calculateDocumentReadiness(state.requirements, state.uploads, state.deleting).canContinue) {
        state.errorKey = 'documentContinueBlocked';
        state._focusError = true;
        renderWizard(root, state);
        return;
    }
    state.formValues = fields;
    state.errorKey = null;
    state.isAdvancing = true;
    try {
        const isInitialDraftCreation = (state.step === 0 && !state.application);
        if (state.step === 0 && !state.application) {
            state.application = await api.createApplicationDraft(createContactDraft(fields));
            clearContactDraftFields(root.ownerDocument.defaultView);
            state.saveStatus = 'saved';
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
        if (state.step === 0 && isInitialDraftCreation && fields.whatsapp_opt_in === true && typeof api.updateCurrentNotificationPreferences === 'function') {
            try {
                const locale = root.ownerDocument?.documentElement?.lang || 'tr';
                const response = await api.updateCurrentNotificationPreferences({
                    whatsapp_opt_in: true,
                    consent_version: WHATSAPP_CONSENT_VERSION,
                    language: locale
                });
                const parsed = parseNotificationPreferences(response, state.application?.id);
                if (parsed.isValidContract && parsed.isVerified && parsed.effectiveWhatsappOptIn) {
                    state.notificationPreference = parsed;
                    state.preferenceWarning = null;
                } else {
                    state.preferenceWarning = { status: 'failed' };
                }
            } catch {
                state.preferenceWarning = { status: 'failed' };
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
        state._animateNextRender = true;
        state.hasUnsubmittedFieldChanges = false;
        state.formValues = null;
        state._focusStepHeading = true;
    } catch (error) {
        state.errorKey = createErrorKey(error, error.code === 'DECLARATION_ACCEPTANCE_REQUIRED' ? 'declarationAcceptanceFailed' : 'applicationSaveFailed');
        if (!state.application && state.step === 0) state.saveStatus = 'failed';
        state._focusError = true;
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
            state._focusError = true;
            renderWizard(root, state);
            return;
        }
    }
    state.formValues = readVisibleFields(root, state.application || {});
    state.step -= 1;
    state._animateNextRender = true;
    state.errorKey = null;
    state._focusStepHeading = true;
    renderWizard(root, state);
}

async function retryNotificationPreference(root, state, api) {
    if (!api?.updateCurrentNotificationPreferences || !state.application) return;
    const button = root.querySelector('[data-action="preference-retry"]');
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    }
    try {
        const locale = root.ownerDocument?.documentElement?.lang || 'tr';
        const response = await api.updateCurrentNotificationPreferences({
            whatsapp_opt_in: true,
            consent_version: WHATSAPP_CONSENT_VERSION,
            language: locale
        });
        const parsed = parseNotificationPreferences(response, state.application?.id);
        if (parsed.isValidContract && parsed.isVerified && parsed.effectiveWhatsappOptIn) {
            state.notificationPreference = parsed;
            state.preferenceWarning = { status: 'saved' };
        } else {
            state.preferenceWarning = { status: 'failed' };
        }
    } catch {
        state.preferenceWarning = { status: 'failed' };
    } finally {
        renderWizard(root, state);
    }
}

async function handleWizardClick(root, state, api, event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const code = button.closest('[data-document-code]')?.dataset.documentCode || button.dataset.targetDocument;
    if (button.dataset.action === 'previous') await handlePrevious(root, state);
    if (button.dataset.action === 'focus-document' && code) {
        const card = [...root.querySelectorAll('.application-document-card')]
            .find((entry) => entry.dataset.documentCode === code);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.querySelector('h3')?.focus({ preventScroll: true });
    }
    if (button.dataset.action === 'go-step') {
        state.formValues = readVisibleFields(root, state.application || {});
        state.step = Number(button.dataset.step);
        state.errorKey = null;
        state._animateNextRender = true;
        state._focusStepHeading = true;
        renderWizard(root, state);
    }
    if (button.dataset.action === 'submit-application') await submitApplication(root, state, api);
    if (button.dataset.action === 'preference-retry') await retryNotificationPreference(root, state, api);
    if (button.dataset.action === 'document-retry' && code) await runUploadTask(code, state.uploads[code], state, api, root, { isRetry: true });
    if (button.dataset.action === 'document-delete' && code) await handleDelete(root, state, api, code);
    if (button.dataset.action === 'document-cancel' && code) state.uploads[code]?.abortController?.abort();
    if (button.dataset.action === 'autosave-retry' && state.autosave) {
        const saved = await state.autosave.flush();
        state.errorKey = saved ? null : 'autosaveFailed';
        if (!saved) state._focusError = true;
        renderWizard(root, state);
    }
}

async function submitApplication(root, state, api) {
    if (state.isSubmitting || state.application?.status !== 'draft') return;
    if (!getReviewReadiness(state.application, state.requirements, state.uploads, state.deleting).canSubmit) return;
    state.isSubmitting = true;
    state.errorKey = null;
    renderWizard(root, state);
    try {
        state.application = await api.submitCurrentApplication();
        clearContactDraftFields(root.ownerDocument.defaultView);
        state.errorKey = null;
        state._focusSubmissionConfirmation = true;
    } catch (error) {
        state.errorKey = createErrorKey(error, 'applicationSubmitFailed');
        state._focusError = true;
        if (error.code === 'APPLICATION_SESSION_REQUIRED') state.saveStatus = 'session_expired';
    } finally {
        state.isSubmitting = false;
        renderWizard(root, state);
    }
}

function canCreateContactDraft(form) {
    if (!form) return false;
    setContactPhoneValidity(form);
    return ['student_number', 'student_email', 'student_phone', 'application_type']
        .every((name) => form.querySelector(`[name="${name}"]`)?.checkValidity() === true);
}

function handleWizardInput(root, state, api) {
    state.hasUnsubmittedFieldChanges = true;
    if (state.step === 0) {
        state.formValues = readVisibleFields(root, state.application || {});
        if (state.application && state.autosave) scheduleCurrentFields(root, state);
        if (!state.application) {
            saveContactDraftFields(root.ownerDocument.defaultView, state.formValues);
            state.saveStatus = 'saving';
            updateSaveStatus(root, state);
            if (state.contactDraftTimer !== null) root.ownerDocument.defaultView.clearTimeout(state.contactDraftTimer);
            const form = root.querySelector('#application-step-form');
            if (!state.isCreatingContactDraft && canCreateContactDraft(form)) {
                state.contactDraftTimer = root.ownerDocument.defaultView.setTimeout(async () => {
                    state.contactDraftTimer = null;
                    if (state.application || state.isCreatingContactDraft) return;
                    state.isCreatingContactDraft = true;
                    try {
                        const fields = readVisibleFields(root, {});
                        state.application = await api.createApplicationDraft(createContactDraft(fields));
                        clearContactDraftFields(root.ownerDocument.defaultView);
                        state.autosave = createAutosave(state, api, root);
                        const latestFields = readVisibleFields(root, state.application);
                        state.autosave.schedule(buildAutosaveValues(latestFields));
                        await state.autosave.flush();
                        state.saveStatus = 'saved';
                        updateSaveStatus(root, state);
                        renderWizard(root, state);
                    } catch {
                        state.saveStatus = 'failed';
                        updateSaveStatus(root, state);
                    } finally {
                        state.isCreatingContactDraft = false;
                    }
                }, 450);
            } else {
                state.contactDraftTimer = root.ownerDocument.defaultView.setTimeout(() => {
                    state.contactDraftTimer = null;
                    state.saveStatus = 'saved';
                    updateSaveStatus(root, state);
                }, 400);
            }
        }
        updateContactContinueButton(root);
        const prefField = root.querySelector('.notification-preference-group');
        if (prefField && typeof prefField.syncPhone === 'function') {
            prefField.syncPhone(state.formValues.student_phone);
        }
        return;
    }
    if (state.step === 1) {
        const birthDate = root.querySelector('[name="date_of_birth"]')?.value || '';
        const ageAnswer = calculateCurrentUnder18(birthDate);
        const ageField = root.querySelector('[name="is_under_18"]');
        if (ageField) ageField.value = ageAnswer === null ? '' : String(ageAnswer);
    }
    if (state.application && state.step <= 1 && state.autosave) scheduleCurrentFields(root, state);
    if (state.step === 1) updateResidenceContinueButton(root, readVisibleFields(root, state.application || {}));
    if (state.step === 3) {
        const checkbox = root.querySelector('[name="declaration_accepted"]');
        const button = root.querySelector('#application-step-form button[type="submit"]');
        if (button) button.disabled = state.isAdvancing || checkbox?.checked !== true;
    }
}

function handleWizardChange(root, state, api, event) {
    const input = event.target;
    if (input instanceof root.ownerDocument.defaultView.HTMLInputElement && input.type === 'file') {
        void handleFileSelection(root, state, api, input);
        return;
    }
    if (input.name === 'fingerprint_status') {
        state.hasUnsubmittedFieldChanges = true;
        scheduleCurrentFields(root, state);
        const fields = readVisibleFields(root, state.application || {});
        fields.fingerprint_code = fields.fingerprint_status === 'registered' ? fields.fingerprint_code || null : null;
        state.formValues = fields;
        state.errorKey = null;
        renderWizard(root, state);
        return;
    }
    handleWizardInput(root, state, api);
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
export async function initializeApplicationWizard(root, api, options = {}) {
    if (!root || !root.ownerDocument) throw new TypeError('An application wizard root is required.');
    const state = {
        application: null,
        requirements: [],
        step: 0,
        errorKey: null,
        saveStatus: 'idle',
        isAdvancing: false,
        isSubmitting: false,
        formValues: null,
        hasUnsubmittedFieldChanges: false,
        uploads: {},
        deleting: {},
        notificationPreference: null,
        _animateNextRender: true,
        navigateHome: (path) => root.ownerDocument.defaultView.location.assign(path),
        navigateToTracking: typeof api.navigateToTracking === 'function'
            ? api.navigateToTracking
            : (path) => root.ownerDocument.defaultView.location.assign(path),
        api
    };
    const guardUnsavedNavigation = (event) => {
        if (!['unsaved', 'saving', 'failed'].includes(state.saveStatus)) return;
        event.preventDefault();
        event.returnValue = '';
    };
    root.ownerDocument.defaultView.addEventListener('beforeunload', guardUnsavedNavigation);
    root.addEventListener('submit', (event) => {
        if (event.target.id !== 'application-step-form') return;
        event.preventDefault();
        void saveStep(root, state, api);
    });
    root.addEventListener('input', () => handleWizardInput(root, state, api));
    root.addEventListener('change', (event) => handleWizardChange(root, state, api, event));
    root.addEventListener('click', (event) => { void handleWizardClick(root, state, api, event); });
    root.ownerDocument.addEventListener('public:locale-changed', () => {
        const active = root.ownerDocument.activeElement;
        const activeName = root.contains(active) ? active.name : null;
        const selection = activeName && Number.isInteger(active.selectionStart)
            ? { start: active.selectionStart, end: active.selectionEnd } : null;
        if (state.hasUnsubmittedFieldChanges && (state.step === 0 || state.step === 1)) {
            state.formValues = readVisibleFields(root, state.application || {});
        }
        renderWizard(root, state);
        if (activeName) {
            const replacement = [...root.querySelectorAll('[name]')].find((element) => element.name === activeName);
            replacement?.focus({ preventScroll: true });
            if (selection && replacement?.setSelectionRange) replacement.setSelectionRange(selection.start, selection.end);
        }
    });
    root.ownerDocument.addEventListener('click', (event) => { void handleReturnHome(event, root, state); });
    if (options.startNewApplication === true) {
        clearContactDraftFields(root.ownerDocument.defaultView);
        state.formValues = {};
        renderWizard(root, state);
        return state;
    }
    try {
        state.application = await api.readCurrentApplication();
        state.saveStatus = 'saved';
        if (state.application.status === 'resubmission_required') {
            state.redirectingToTracking = true;
            state.navigateToTracking('/basvurum/');
            renderWizard(root, state);
            return state;
        }
        if (state.application.status !== 'draft') {
            // A submitted application is finished: "Start application" always opens a blank contact form.
            clearContactDraftFields(root.ownerDocument.defaultView);
            state.application = null;
            state.saveStatus = 'idle';
            state.formValues = {};
            state.step = 0;
            renderWizard(root, state);
            return state;
        }
        clearContactDraftFields(root.ownerDocument.defaultView);
        state.step = state.application.status === 'submitted' ? 4
            : (state.application.contact_acknowledgement?.accepted_current === true ? 1 : 0);
        state.autosave = createAutosave(state, api, root);
        if (typeof api.readCurrentNotificationPreferences === 'function') {
            try {
                state.notificationPreference = await api.readCurrentNotificationPreferences();
            } catch {
                // Non-fatal if preference read fails
            }
        }
        await refreshRequirements(state, api);
    } catch (error) {
        state.errorKey = error.code === 'APPLICATION_SESSION_REQUIRED' ? null : 'applicationLoadFailed';
        if (!state.application) {
            const restored = loadContactDraftFields(root.ownerDocument.defaultView);
            if (restored) {
                state.formValues = restored;
                state.saveStatus = 'saved';
            }
        }
    }
    renderWizard(root, state);
    return state;
}
