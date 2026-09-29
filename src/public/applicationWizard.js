import { PUBLIC_MESSAGES } from './i18n/messages.js';

function createTranslatedElement(document, tag, key, text) {
    const element = document.createElement(tag);
    element.dataset.i18n = key;
    element.textContent = text;
    return element;
}

function createFingerprintChoice(document, value, key, selected, messages) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'fingerprint_status';
    input.value = value;
    input.checked = selected === value;
    input.required = true;
    const text = createTranslatedElement(document, 'span', key, messages[key]);
    label.append(input, text);
    return label;
}

/**
 * Renders the separate fingerprint registration state and code input for the applicant.
 * @param {HTMLElement} root Student wizard content container.
 * @param {object} application Student-safe application fields.
 * @returns {HTMLElement} The rendered fingerprint fieldset.
 */
export function renderFingerprintSection(root, application) {
    const document = root.ownerDocument;
    const locale = document.documentElement.lang;
    const messages = PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr;
    const fieldset = document.createElement('fieldset');
    const selected = application.fingerprint_status;
    fieldset.className = 'application-fieldset fingerprint-fields';
    fieldset.append(createTranslatedElement(document, 'legend', 'fingerprintQuestion', messages.fingerprintQuestion));
    fieldset.append(
        createFingerprintChoice(document, 'registered', 'yes', selected, messages),
        createFingerprintChoice(document, 'not_registered', 'no', selected, messages)
    );

    if (selected === 'registered') appendFingerprintCode(document, fieldset, application, messages);
    if (selected === 'not_registered') {
        fieldset.append(createTranslatedElement(document, 'p', 'fingerprintNotRegisteredNotice', messages.fingerprintNotRegisteredNotice));
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
    input.autocomplete = 'off';
    input.value = application.fingerprint_code || '';
    label.append(createTranslatedElement(document, 'span', 'fingerprintCodeLabel', messages.fingerprintCodeLabel), input);
    fieldset.append(label);
    if (!input.value.trim()) fieldset.append(createTranslatedElement(document, 'p', 'fingerprintCodeMissing', messages.fingerprintCodeMissing));
}

const STEP_MESSAGE_KEYS = Object.freeze(['stepContact', 'stepResidence', 'stepDocuments', 'stepReview']);
const DOCUMENT_MESSAGE_KEYS = Object.freeze({
    residence_application_form: 'documentResidenceApplicationForm',
    passport_identity: 'documentPassportIdentity',
    photographs: 'documentPhotographs',
    health_insurance: 'documentHealthInsurance',
    uets: 'documentUets',
    student_certificate: 'documentStudentCertificate',
    residence_permit_fee: 'documentResidencePermitFee',
    address_document: 'documentAddressDocument',
    fingerprint: 'documentFingerprint',
    home_utility_bill: 'documentHomeUtilityBill',
    birth_certificate: 'documentBirthCertificateUnder18',
    birth_certificate_under18: 'documentBirthCertificateUnder18'
});

function readMessages(document) {
    return PUBLIC_MESSAGES[document.documentElement.lang] || PUBLIC_MESSAGES.tr;
}

function createTextField(document, { key, name, value, type = 'text', required = false, disabled = false, maxLength = 255 }) {
    const messages = readMessages(document);
    const label = document.createElement('label');
    const input = document.createElement('input');
    label.className = 'application-form-field';
    label.append(createTranslatedElement(document, 'span', key, messages[key]));
    input.type = type;
    input.name = name;
    input.value = value || '';
    input.required = required;
    input.disabled = disabled;
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
    options.forEach(({ value: optionValue, key: optionKey }) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = messages[optionKey];
        option.dataset.i18n = optionKey;
        select.append(option);
    });
    select.value = value ?? '';
    label.append(select);
    return label;
}

function createWizardForm(document) {
    const form = document.createElement('form');
    form.id = 'application-step-form';
    form.noValidate = false;
    return form;
}

function createContactStep(document, application, formValues) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    form.append(createTextField(document, {
        key: 'studentNumber', name: 'student_number', value: fields.student_number,
        required: true, disabled: Boolean(application), maxLength: 64
    }));
    form.append(createTextField(document, {
        key: 'email', name: 'student_email', type: 'email', value: fields.student_email,
        required: true, maxLength: 254
    }));
    form.append(createTextField(document, {
        key: 'phone', name: 'student_phone', type: 'tel', value: fields.student_phone,
        required: true, maxLength: 40
    }));
    const applicationType = createSelectField(document, {
        key: 'applicationType', name: 'application_type', value: fields.application_type,
        required: true, options: [
            { value: '', key: 'applicationType' },
            { value: 'initial', key: 'initialApplication' },
            { value: 'renewal', key: 'renewalApplication' }
        ]
    });
    applicationType.querySelector('select').disabled = Boolean(application);
    form.append(applicationType);
    form.append(createContinueButton(document, messages));
    return form;
}

function createResidenceStep(document, application, formValues) {
    const messages = readMessages(document);
    const fields = { ...application, ...formValues };
    const form = createWizardForm(document);
    form.append(createTextField(document, { key: 'firstName', name: 'first_name', value: fields.first_name }));
    form.append(createTextField(document, { key: 'lastName', name: 'last_name', value: fields.last_name }));
    form.append(createTextField(document, { key: 'passportNumber', name: 'passport_number', value: fields.passport_number }));
    form.append(createTextField(document, { key: 'nationality', name: 'nationality', value: fields.nationality }));
    form.append(createTextField(document, { key: 'dateOfBirth', name: 'date_of_birth', type: 'date', value: fields.date_of_birth }));
    form.append(createSelectField(document, {
        key: 'under18Question', name: 'is_under_18',
        value: application.is_under_18 === 1 || fields.is_under_18 === true
            ? 'true'
            : (application.is_under_18 === 0 || fields.is_under_18 === false ? 'false' : ''),
        required: true, options: [
            { value: '', key: 'under18Question' },
            { value: 'true', key: 'yes' },
            { value: 'false', key: 'no' }
        ]
    }));
    renderFingerprintSection(form, fields);
    form.append(createContinueButton(document, messages));
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

function createPreviousButton(document, messages) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'application-button application-button-secondary';
    button.dataset.action = 'previous';
    button.dataset.i18n = 'previous';
    button.textContent = messages.previous;
    return button;
}

function createDocumentStatus(document, requirement, messages) {
    const status = document.createElement('p');
    let key = 'documentNotUploaded';
    if (requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required') key = 'documentNeedsReplacement';
    else if (requirement.review_status === 'approved' || requirement.revision_status === 'approved') key = 'documentApproved';
    else if (requirement.upload_status === 'finalized') key = 'uploadedWaitingReview';
    status.className = 'document-upload-status';
    status.dataset.i18n = key;
    status.textContent = messages[key];
    return status;
}

function createDocumentCard(document, requirement, { allowUpload, isBusy }) {
    const messages = readMessages(document);
    const card = document.createElement('article');
    const name = document.createElement('h3');
    const labelKey = DOCUMENT_MESSAGE_KEYS[requirement.code] || 'documentNotUploaded';
    name.dataset.i18n = labelKey;
    name.textContent = messages[labelKey];
    card.className = 'application-document-card';
    card.append(name);
    card.append(createRequirementBadge(document, requirement.is_required, messages));
    card.append(createDocumentStatus(document, requirement, messages));
    if (requirement.filename) appendFilename(document, card, requirement.filename);
    if (allowUpload) card.append(createFileInput(document, requirement.code, messages, isBusy));
    return card;
}

function createRequirementBadge(document, isRequired, messages) {
    const badge = document.createElement('span');
    const key = isRequired ? 'required' : 'optional';
    badge.className = isRequired ? 'requirement-badge is-required' : 'requirement-badge';
    badge.dataset.i18n = key;
    badge.textContent = messages[key];
    return badge;
}

function appendFilename(document, card, filename) {
    const name = document.createElement('p');
    name.className = 'application-document-filename';
    name.textContent = filename;
    card.append(name);
}

function createFileInput(document, code, messages, isBusy) {
    const label = document.createElement('label');
    const text = createTranslatedElement(document, 'span', 'uploadDocument', messages.uploadDocument);
    const input = document.createElement('input');
    const help = createTranslatedElement(document, 'small', 'allowedFileTypes', messages.allowedFileTypes);
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
    input.dataset.documentCode = code;
    input.disabled = isBusy;
    label.className = 'application-upload-control';
    label.append(text, input, help);
    return label;
}

function createDocumentList(document, requirements, { allowUpload, isBusy }) {
    const list = document.createElement('div');
    list.className = 'application-document-list';
    requirements.forEach((requirement) => list.append(createDocumentCard(document, requirement, { allowUpload, isBusy })));
    return list;
}

/**
 * Renders student-safe requirement rows without exposing internal database identifiers.
 * @param {HTMLElement} root Requirement list container.
 * @param {Array<object>} requirements Server-calculated student document requirements.
 * @returns {void} Replaces the container contents with localized document cards.
 */
export function renderStudentDocumentRequirements(root, requirements) {
    root.replaceChildren(createDocumentList(root.ownerDocument, requirements, { allowUpload: false, isBusy: false }));
}

function createFingerprintReview(document, application) {
    const messages = readMessages(document);
    const section = document.createElement('section');
    const heading = createTranslatedElement(document, 'h3', 'reviewFingerprintHeading', messages.reviewFingerprintHeading);
    const status = document.createElement('p');
    const statusKey = application.fingerprint_status === 'registered'
        ? 'fingerprintRegistered'
        : (application.fingerprint_status === 'not_registered' ? 'fingerprintNotRegistered' : 'fingerprintUnanswered');
    section.className = 'application-review-section';
    status.dataset.i18n = statusKey;
    status.textContent = messages[statusKey];
    section.append(heading, status);
    if (application.fingerprint_status === 'registered') appendFingerprintReviewCode(document, section, application, messages);
    if (application.fingerprint_status === 'not_registered') {
        section.append(createTranslatedElement(document, 'p', 'fingerprintNotRegisteredNotice', messages.fingerprintNotRegisteredNotice));
    }
    if (!application.fingerprint_status) section.append(createTranslatedElement(document, 'p', 'fingerprintAnswerMissing', messages.fingerprintAnswerMissing));
    return section;
}

function appendFingerprintReviewCode(document, section, application, messages) {
    const codeLabel = document.createElement('p');
    const code = document.createElement('code');
    codeLabel.append(createTranslatedElement(document, 'span', 'reviewFingerprintCode', messages.reviewFingerprintCode));
    if (application.fingerprint_code) {
        code.textContent = application.fingerprint_code;
        codeLabel.append(document.createTextNode(': '), code);
        section.append(codeLabel);
        return;
    }
    section.append(codeLabel, createTranslatedElement(document, 'p', 'fingerprintCodeMissing', messages.fingerprintCodeMissing));
}

function createReviewStep(document, state) {
    const messages = readMessages(document);
    const review = document.createElement('div');
    const heading = createTranslatedElement(document, 'p', 'reviewHeading', messages.reviewHeading);
    review.className = 'application-review';
    review.append(heading, createFingerprintReview(document, state.application));
    review.append(createDocumentList(document, state.requirements, { allowUpload: false, isBusy: state.isBusy }));
    return review;
}

function createStepHeading(document, step) {
    const key = STEP_MESSAGE_KEYS[step];
    const messages = readMessages(document);
    return createTranslatedElement(document, 'h2', key, messages[key]);
}

function createProgress(document, step) {
    const list = document.createElement('ol');
    list.className = 'application-progress';
    STEP_MESSAGE_KEYS.forEach((key, index) => {
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
    panel.setAttribute('aria-busy', String(state.isBusy));
    panel.append(createProgress(document, state.step), createStepHeading(document, state.step));
    if (state.errorKey) {
        const error = createTranslatedElement(document, 'p', state.errorKey, messages[state.errorKey]);
        error.setAttribute('role', 'alert');
        panel.append(error);
    }
    if (state.step === 0) stage.append(createContactStep(document, state.application, state.formValues));
    if (state.step === 1) stage.append(createResidenceStep(document, state.application, state.formValues));
    if (state.step === 2) appendDocumentsStep(document, stage, state, messages);
    if (state.step === 3) stage.append(createReviewStep(document, state));
    if (state.step > 0) panel.append(createPreviousButton(document, messages));
    panel.append(stage);
    root.replaceChildren(panel);
}

function appendDocumentsStep(document, stage, state, messages) {
    const help = createTranslatedElement(document, 'p', 'allowedFileTypes', messages.allowedFileTypes);
    const form = createWizardForm(document);
    form.append(help, createDocumentList(document, state.requirements, { allowUpload: true, isBusy: state.isBusy }));
    form.append(createContinueButton(document, messages));
    stage.append(form);
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
        fields[input.name] = input.value;
    });
    return fields;
}

function createContactDraft(fields) {
    return {
        student_number: fields.student_number,
        application_type: fields.application_type,
        email: fields.student_email,
        phone: fields.student_phone
    };
}

function createResidencePatch(fields) {
    const patch = { is_under_18: fields.is_under_18, fingerprint_status: fields.fingerprint_status };
    for (const field of ['first_name', 'last_name', 'passport_number', 'nationality', 'date_of_birth']) {
        if (typeof fields[field] === 'string' && fields[field].trim()) patch[field] = fields[field].trim();
    }
    patch.fingerprint_code = fields.fingerprint_status === 'registered'
        ? (typeof fields.fingerprint_code === 'string' ? fields.fingerprint_code.trim() || null : null)
        : null;
    return patch;
}

function getFailureKey(error, step) {
    if (step === 2) return 'uploadFailed';
    if (step === 0 && error.code === 'APPLICATION_SESSION_REQUIRED') return null;
    return step === 0 && !error.code ? 'applicationLoadFailed' : 'applicationSaveFailed';
}

async function loadRequirements(state, api) {
    const result = await api.readCurrentStudentDocumentRequirements();
    state.requirements = result.requirements;
}

async function saveCurrentStep(root, state, api) {
    if (state.isBusy) return;
    const form = root.querySelector('#application-step-form');
    if (form && !form.reportValidity()) return;
    const fields = readVisibleFields(root, state.application || {});
    state.errorKey = null;
    const hadApplication = Boolean(state.application);
    state.formValues = fields;
    state.isBusy = true;
    renderWizard(root, state);
    try {
        await persistStepFields(state, api, fields, hadApplication);
        if (state.step === 1 || state.step === 2) await loadRequirements(state, api);
        state.step = Math.min(state.step + 1, 3);
        state.formValues = null;
    } catch (error) {
        state.errorKey = getFailureKey(error, state.step);
    } finally {
        state.isBusy = false;
        renderWizard(root, state);
    }
}

async function persistStepFields(state, api, fields, hadApplication) {
    if (state.step === 0 && hadApplication) {
        state.application = await api.updateCurrentApplication({
            student_email: fields.student_email.trim(), student_phone: fields.student_phone.trim()
        });
        return;
    }
    if (state.step === 0) {
        state.application = await api.createApplicationDraft(createContactDraft(fields));
        return;
    }
    if (state.step === 1) state.application = await api.updateCurrentApplication(createResidencePatch(fields));
}

async function handleFileSelection(root, state, api, input) {
    if (state.isBusy) return;
    const file = input.files?.[0];
    if (!file) return;
    state.isBusy = true;
    state.errorKey = null;
    renderWizard(root, state);
    try {
        await api.uploadStudentDocument(input.dataset.documentCode, file);
        await loadRequirements(state, api);
    } catch (error) {
        state.errorKey = getFailureKey(error, 2);
    } finally {
        state.isBusy = false;
        renderWizard(root, state);
    }
}

function handleWizardChange(root, state, api, event) {
    const input = event.target;
    if (input instanceof root.ownerDocument.defaultView.HTMLInputElement
        && input.type === 'file') {
        void handleFileSelection(root, state, api, input);
        return;
    }
    if (input.name === 'fingerprint_status') {
        const fields = readVisibleFields(root, state.application || {});
        state.formValues = {
            ...state.formValues,
            ...fields,
            fingerprint_status: fields.fingerprint_status,
            fingerprint_code: fields.fingerprint_status === 'registered' ? fields.fingerprint_code || null : null
        };
        renderWizard(root, state);
    }
}

function handleWizardClick(root, state, event) {
    if (state.isBusy) return;
    if (event.target.closest('[data-action="previous"]')) {
        state.application = readVisibleFields(root, state.application || {});
        state.step = Math.max(0, state.step - 1);
        state.errorKey = null;
        renderWizard(root, state);
    }
}

/**
 * Starts or resumes the public application wizard using the current owner session.
 * @param {HTMLElement} root Wizard mount element.
 * @param {object} api Application API functions, overridable for isolated UI tests.
 * @returns {Promise<object>} Live wizard state for the initialized page.
 * @throws {TypeError} When the wizard mount element is missing.
 */
export async function initializeApplicationWizard(root, api) {
    if (!root || !root.ownerDocument) throw new TypeError('An application wizard root is required.');
    const state = { application: null, requirements: [], step: 0, errorKey: null, isBusy: false, formValues: null };
    root.addEventListener('submit', (event) => {
        if (event.target.id !== 'application-step-form') return;
        event.preventDefault();
        void saveCurrentStep(root, state, api);
    });
    root.addEventListener('change', (event) => handleWizardChange(root, state, api, event));
    root.addEventListener('click', (event) => handleWizardClick(root, state, event));
    try {
        state.application = await api.readCurrentApplication();
        state.step = 1;
        await loadRequirements(state, api);
    } catch (error) {
        state.errorKey = getFailureKey(error, 0);
    }
    renderWizard(root, state);
    return state;
}
