import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';
import { initializeResubmissionUpload } from './resubmissionUpload.js';
import { mountTrackingNotificationPreferences } from './notificationPreferences.js';
import { PILOT_UX_MESSAGES } from './i18n/pilotUxMessages.js';

function readMessages(locale) {
    const fallback = { ...SESSION3_MESSAGES.tr, ...PUBLIC_MESSAGES.tr, ...PILOT_UX_MESSAGES.tr };
    const selected = { ...SESSION3_MESSAGES[locale], ...PUBLIC_MESSAGES[locale], ...PILOT_UX_MESSAGES[locale] };
    return { ...fallback, ...selected };
}

function createTextElement(document, tagName, className, value) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value;
    return element;
}

function createLink(document, href, label, className = 'application-button application-button-secondary') {
    const link = document.createElement('a');
    link.href = href;
    link.className = className;
    link.textContent = label;
    return link;
}

function formatDate(value, locale) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function appendDetail(document, list, label, value) {
    const term = createTextElement(document, 'dt', '', label);
    const detail = createTextElement(document, 'dd', '', value);
    list.append(term, detail);
}

function createLookupForm(document, state, messages, submitLookup) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    const isSubmitting = state.kind === 'lookupLoading';
    form.className = 'tracking-lookup-form';
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitLookup(input.value);
    });
    input.type = 'text';
    input.name = 'student_number';
    input.maxLength = 64;
    input.required = true;
    input.autocomplete = 'off';
    input.value = state.studentNumber;
    input.id = 'tracking-student-number';
    input.setAttribute('aria-label', messages.trackingLookupStudentNumberLabel);
    input.addEventListener('input', () => {
        state.studentNumber = input.value;
    });
    const label = createTextElement(document, 'label', '', messages.trackingLookupStudentNumberLabel);
    label.htmlFor = input.id;
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'application-button application-button-primary';
    button.disabled = isSubmitting;
    button.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
    button.textContent = isSubmitting ? messages.trackingLoading : messages.trackingLookupSubmit;
    form.append(label, input, button);
    return form;
}

function renderLookup(root, state, messages, submitLookup) {
    const document = root.ownerDocument;
    const panel = document.createElement('section');
    panel.className = 'tracking-state tracking-lookup';
    panel.append(
        createTextElement(document, 'h2', '', messages.trackingLookupHeading),
        createTextElement(document, 'p', '', messages.trackingLookupExplanation),
        createTextElement(document, 'p', 'tracking-owner-access-note', messages.trackingOwnerAccess),
        createLink(document, '/basvuru/#resume-application-form', messages.trackingOwnerAccessLink, 'tracking-owner-access-link'),
        createLookupForm(document, state, messages, submitLookup)
    );
    const feedbackKey = state.kind === 'notFound' ? 'trackingLookupNotFound'
        : state.kind === 'rateLimited' ? 'trackingLookupRateLimited'
            : state.kind === 'lookupError' ? 'trackingLookupError' : null;
    if (feedbackKey) {
        const feedback = createTextElement(document, 'p', 'tracking-message tracking-feedback', messages[feedbackKey]);
        feedback.setAttribute('role', 'alert');
        feedback.dataset.feedbackType = state.kind === 'notFound' ? 'warning' : 'error';
        panel.append(feedback);
    }
    root.replaceChildren(panel);
}

function renderDraft(root, messages) {
    const panel = root.ownerDocument.createElement('section');
    panel.className = 'tracking-state';
    panel.append(
        createTextElement(root.ownerDocument, 'h2', '', messages.trackingDraftHeading),
        createTextElement(root.ownerDocument, 'p', '', messages.trackingDraftText),
        createLink(root.ownerDocument, '/basvuru/', messages.trackingReturnToApplication),
        createLink(root.ownerDocument, '/', messages.homeLink)
    );
    root.replaceChildren(panel);
}

function readApplicationStatusLabel(messages, status) {
    return messages[`applicationStatus_${status}`] || messages.trackingStatusUnknown;
}

function createApplicationSummary(document, application, messages, locale) {
    const section = document.createElement('section');
    const details = document.createElement('dl');
    section.className = 'tracking-summary';
    section.append(createTextElement(document, 'h2', '', messages.trackingApplicationDetails));
    details.className = 'tracking-details';
    appendDetail(document, details, messages.studentNumber, application.student_number || '');
    appendDetail(document, details, messages.applicationType, messages[`${application.application_type}Application`] || messages.trackingStatusUnknown);
    appendDetail(document, details, messages.trackingStatusLabel, readApplicationStatusLabel(messages, application.status));

    const dates = [
        ['created_at', 'trackingCreatedAt'],
        ['updated_at', 'trackingUpdatedAt'],
        ['submitted_at', 'trackingSubmittedAt']
    ];
    dates.forEach(([field, label]) => {
        const value = formatDate(application[field], locale);
        if (value) appendDetail(document, details, messages[label], value);
    });
    section.append(details);
    return section;
}

function createDocumentList(document, documents, messages, allowFilename, replacementDocuments, onReplacementComplete, onSessionFailure, replacementCompleted) {
    const section = document.createElement('section');
    const list = document.createElement('ul');
    section.className = 'tracking-documents-section';
    section.append(createTextElement(document, 'h2', '', messages.trackingDocumentsHeading));
    list.className = 'tracking-document-list';

    documents.forEach((item) => {
        const card = document.createElement('li');
        const title = createTextElement(document, 'h3', '', messages[item.label_key] || messages.trackingStatusUnknown);
        const status = createTextElement(document, 'p', 'tracking-document-status', messages[`trackingDocumentStatus_${item.status}`] || messages.trackingStatusUnknown);
        card.className = 'tracking-document-card';
        card.append(title, status);
        if (item.required) card.append(createTextElement(document, 'span', 'public-document-badge', messages.trackingRequiredBadge));
        if (allowFilename && item.filename) card.append(createTextElement(document, 'p', 'application-document-filename', item.filename));
        if (item.student_message) {
            card.append(
                createTextElement(document, 'strong', 'tracking-document-message-label', messages.trackingDocumentMessageLabel),
                createTextElement(document, 'p', 'tracking-document-message', item.student_message)
            );
        }
        const replacementInfo = replacementCompleted?.[item.code];
        if (replacementInfo) {
            const successNotice = document.createElement('div');
            successNotice.className = 'tracking-card-success';
            successNotice.setAttribute('role', 'status');
            successNotice.setAttribute('aria-live', 'polite');
            const successTitle = createTextElement(
                document,
                'p',
                'tracking-card-success-title',
                messages.replacementSuccessUploaded || 'Belge başarıyla yüklendi.'
            );
            const scanStatusLabel = messages.replacementScanStatusLabel || 'Güncel tarama durumu';
            const scanStatusWaiting = messages.replacementScanStatusWaiting || 'Güvenlik taraması bekleniyor (İnceleme bekliyor)';
            const scanStatusP = createTextElement(
                document,
                'p',
                'tracking-card-scan-status',
                `${scanStatusLabel}: ${scanStatusWaiting}`
            );
            successNotice.append(successTitle, scanStatusP);
            card.append(successNotice);
        }
        const replacement = replacementDocuments?.find((entry) => entry.code === item.code);
        if (allowFilename && replacement) {
            initializeResubmissionUpload(card, replacement, replacement.api, {
                messages, onComplete: onReplacementComplete, onSessionFailure,
                putStudentDocumentDirect: replacement.api.putStudentDocumentDirect
            });
        }
        list.append(card);
    });
    section.append(list);
    return section;
}

function renderTracking(root, state, locale, submitLookup, api) {
    const document = root.ownerDocument;
    const messages = readMessages(locale);
    root.className = 'application-tracking';
    if (state.kind === 'loading') {
        root.replaceChildren(createTextElement(document, 'p', 'tracking-message', messages.trackingLoading));
        return;
    }
    if (['lookup', 'lookupLoading', 'notFound', 'rateLimited', 'lookupError'].includes(state.kind)) {
        renderLookup(root, state, messages, submitLookup);
        return;
    }
    if (state.kind === 'error') {
        root.replaceChildren(createTextElement(document, 'p', 'tracking-message', messages.trackingLoadError));
        return;
    }
    if (state.kind === 'draft') {
        renderDraft(root, messages);
        return;
    }
    const summary = createApplicationSummary(document, state.payload.application, messages, locale);
    const documentList = createDocumentList(document, state.payload.documents, messages, state.kind === 'ready',
        state.replacementDocuments, state.onReplacementComplete, state.onSessionFailure, state.replacementCompleted);
    if (state.replacementSuccess) {
        const successNotice = document.createElement('div');
        successNotice.className = 'tracking-success-banner';
        successNotice.setAttribute('role', 'status');
        successNotice.setAttribute('aria-live', 'polite');
        const successText = createTextElement(document, 'p', 'tracking-message tracking-message-success', messages.resubmissionUploadComplete);
        successNotice.append(successText);
        root.replaceChildren(successNotice, summary, documentList);
    } else {
        root.replaceChildren(summary, documentList);
    }
    if (state.kind === 'ready' && typeof api?.readCurrentNotificationPreferences === 'function') {
        void mountTrackingNotificationPreferences(root, {
            application: state.payload.application,
            api,
            locale,
            initialPreference: state.notificationPreference,
            onPreferenceChange: (pref) => {
                state.notificationPreference = pref;
            }
        });
    }
}

/**
 * Loads and renders tracking data for the current applicant session.
 * @param {HTMLElement} root Tracking-page mount element.
 * @param {{readCurrentApplicationTracking: () => Promise<object>, lookupApplicationTracking: (studentNumber: string) => Promise<object>}} api Same-origin application API helpers.
 * @returns {Promise<{kind: string}>} Initial tracking view state.
 */
export async function initializeApplicationTracking(root, api) {
    const document = root.ownerDocument;
    const state = { kind: 'loading', payload: null, studentNumber: '', replacementDocuments: [], notificationPreference: null, replacementSuccess: false, replacementCompleted: {} };
    const render = () => renderTracking(root, state, document.documentElement.lang || 'tr', submitLookup, api);
    async function submitLookup(studentNumber) {
        state.studentNumber = studentNumber.trim();
        state.kind = 'lookupLoading';
        render();
        try {
            state.payload = await api.lookupApplicationTracking(state.studentNumber);
            state.kind = state.payload.found ? 'publicReady' : 'notFound';
        } catch (error) {
            state.kind = error?.code === 'RATE_LIMITED' ? 'rateLimited' : 'lookupError';
        }
        render();
    }
    document.addEventListener('public:locale-changed', render);
    render();
    try {
        state.payload = await api.readCurrentApplicationTracking();
        state.kind = state.payload.application.status === 'draft' ? 'draft' : 'ready';
        if (state.payload.application.status === 'resubmission_required'
            && typeof api.readCurrentResubmissionEligibility === 'function') {
            try {
                const eligibility = await api.readCurrentResubmissionEligibility();
                state.replacementDocuments = (eligibility.documents || []).map((requirement) => ({ ...requirement, api }));
                state.onReplacementComplete = async (code, meta) => {
                    state.replacementCompleted = state.replacementCompleted || {};
                    const targetCode = code || (state.replacementDocuments?.length === 1 ? state.replacementDocuments[0].code : null);
                    if (targetCode) {
                        state.replacementCompleted[targetCode] = {
                            scan_status: meta?.scan_status || 'pending'
                        };
                    }
                    state.payload = await api.readCurrentApplicationTracking();
                    state.replacementDocuments = [];
                    state.replacementSuccess = true;
                    if (state.payload.application.status === 'resubmission_required') {
                        const refreshed = await api.readCurrentResubmissionEligibility();
                        state.replacementDocuments = (refreshed.documents || []).map((requirement) => ({ ...requirement, api }));
                    }
                    render();
                };
                state.onSessionFailure = () => {
                    state.kind = 'lookup';
                    state.payload = null;
                    state.replacementDocuments = [];
                    state.replacementCompleted = {};
                    render();
                };
            } catch (error) {
                if (error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED') {
                    state.kind = 'lookup';
                    state.payload = null;
                }
            }
        }
    } catch (error) {
        state.kind = error?.code === 'APPLICATION_SESSION_REQUIRED' || error?.status === 401
            ? 'lookup' : 'error';
    }
    render();
    return { kind: state.kind };
}
