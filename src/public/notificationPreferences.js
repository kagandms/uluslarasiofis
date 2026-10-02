import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from './i18n/messages.js';

export const WHATSAPP_CONSENT_VERSION = 'whatsapp-consent-v1';

function readMessages(document) {
    const locale = document?.documentElement?.lang || 'tr';
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

/**
 * Normalizes notification preferences response from either baseline (c59e56c) or extended contract.
 * @param {object|null} data Raw API response object.
 * @returns {object} Normalized preference descriptor.
 */
export function parseNotificationPreferences(data) {
    if (!data || typeof data !== 'object') {
        return {
            applicationId: null,
            whatsappOptIn: false,
            consentVersion: null,
            language: null,
            currentConsentVersion: WHATSAPP_CONSENT_VERSION,
            effectiveWhatsappOptIn: false,
            requiresReconsent: false,
            canOptIn: true
        };
    }
    const consentVersion = data.consent_version ?? null;
    const currentConsentVersion = data.current_consent_version || WHATSAPP_CONSENT_VERSION;
    const effectiveWhatsappOptIn = typeof data.effective_whatsapp_opt_in === 'boolean'
        ? data.effective_whatsapp_opt_in
        : Boolean(data.whatsapp_opt_in && consentVersion === WHATSAPP_CONSENT_VERSION);
    const requiresReconsent = typeof data.requires_reconsent === 'boolean'
        ? data.requires_reconsent
        : Boolean(data.whatsapp_opt_in && consentVersion && consentVersion !== WHATSAPP_CONSENT_VERSION);
    const canOptIn = typeof data.can_opt_in === 'boolean' ? data.can_opt_in : true;

    return {
        applicationId: data.application_id ?? null,
        whatsappOptIn: Boolean(data.whatsapp_opt_in),
        consentVersion,
        language: data.language ?? null,
        currentConsentVersion,
        effectiveWhatsappOptIn,
        requiresReconsent,
        canOptIn
    };
}

function resolveErrorMessage(messages, error) {
    if (error?.status === 401 || error?.code === 'APPLICATION_SESSION_REQUIRED') {
        return messages.whatsappPreferenceSessionExpired;
    }
    if (error?.code === 'CONSENT_VERSION_INVALID') {
        return messages.whatsappPreferenceVersionInvalid;
    }
    if (error?.status === 409 || error?.code === 'RECIPIENT_UNAVAILABLE') {
        return messages.whatsappPhoneRequired;
    }
    return messages.whatsappPreferenceFailed;
}

/**
 * Creates the optional WhatsApp notification preference field for Contact step.
 * @param {Document} document DOM Document.
 * @param {object} options Configuration and initial values.
 * @returns {HTMLElement} Container with preference checkbox and accessible guidance.
 */
export function createNotificationPreferenceField(document, {
    application = null,
    initialPreference = null,
    formValues = null,
    api = null,
    onPreferenceChange = null
} = {}) {
    const messages = readMessages(document);
    const container = document.createElement('div');
    container.className = 'notification-preference-group';

    const label = document.createElement('label');
    label.className = 'notification-preference-label';
    label.htmlFor = 'field-whatsapp-opt-in';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'whatsapp_opt_in';
    checkbox.id = 'field-whatsapp-opt-in';
    checkbox.className = 'notification-preference-checkbox';

    const textSpan = createTranslatedElement(document, 'span', 'whatsappConsentLabel', messages.whatsappConsentLabel);
    textSpan.className = 'notification-preference-text';
    label.append(checkbox, textSpan);

    const explanation = createTranslatedElement(document, 'p', 'whatsappConsentExplanation', messages.whatsappConsentExplanation);
    explanation.className = 'notification-preference-explanation';

    const notice = document.createElement('p');
    notice.className = 'notification-preference-notice';
    notice.setAttribute('role', 'status');
    notice.style.display = 'none';

    const status = document.createElement('p');
    status.className = 'notification-preference-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.display = 'none';

    let currentPreference = parseNotificationPreferences(initialPreference);
    let isSaving = false;
    let inFlightController = null;
    let initialPhone = application?.student_phone || '';

    // Determine initial checked state:
    // 1. Form values explicitly set by user in current wizard session takes precedence
    // 2. Otherwise use effective preference from server if valid and not requiring reconsent
    // 3. Otherwise default unchecked
    if (formValues && typeof formValues.whatsapp_opt_in === 'boolean') {
        checkbox.checked = formValues.whatsapp_opt_in;
    } else if (currentPreference.effectiveWhatsappOptIn && !currentPreference.requiresReconsent) {
        checkbox.checked = true;
    } else {
        checkbox.checked = false;
    }

    function updateNotices() {
        const activeMessages = readMessages(document);
        if (currentPreference.canOptIn === false) {
            checkbox.disabled = true;
            notice.dataset.i18n = 'whatsappPhoneRequired';
            notice.textContent = activeMessages.whatsappPhoneRequired;
            notice.style.display = '';
            return;
        }
        checkbox.disabled = false;
        if (currentPreference.requiresReconsent) {
            notice.dataset.i18n = 'whatsappReconsentRequired';
            notice.textContent = activeMessages.whatsappReconsentRequired;
            notice.style.display = '';
        } else {
            notice.style.display = 'none';
            notice.textContent = '';
        }
    }

    updateNotices();

    async function savePreference(optIn) {
        if (!api || typeof api.updateCurrentNotificationPreferences !== 'function') return;
        if (!application || application.status !== 'draft') return;

        inFlightController?.abort();
        inFlightController = new AbortController();
        const currentController = inFlightController;

        isSaving = true;
        checkbox.disabled = true;
        const activeMessages = readMessages(document);
        status.style.display = '';
        status.removeAttribute('role');
        status.setAttribute('role', 'status');
        status.dataset.i18n = 'whatsappPreferenceSaving';
        status.textContent = activeMessages.whatsappPreferenceSaving;

        try {
            const locale = document.documentElement.lang || 'tr';
            const payload = optIn
                ? { whatsapp_opt_in: true, consent_version: WHATSAPP_CONSENT_VERSION, language: locale }
                : { whatsapp_opt_in: false };

            const response = await api.updateCurrentNotificationPreferences(payload);
            if (currentController.signal.aborted) return;

            currentPreference = parseNotificationPreferences(response);
            status.dataset.i18n = 'whatsappPreferenceSaved';
            status.textContent = activeMessages.whatsappPreferenceSaved;
            updateNotices();
        } catch (error) {
            if (currentController.signal.aborted) return;
            status.setAttribute('role', 'alert');
            status.textContent = resolveErrorMessage(activeMessages, error);
            // On save failure, keep user's checked selection intact as per specification
        } finally {
            if (inFlightController === currentController) {
                isSaving = false;
                inFlightController = null;
                if (currentPreference.canOptIn !== false) checkbox.disabled = false;
            }
        }
    }

    checkbox.addEventListener('change', () => {
        onPreferenceChange?.(checkbox.checked);
        // Only trigger immediate API save if an application draft session already exists
        if (application && api) {
            void savePreference(checkbox.checked);
        }
    });

    // Helper attached to container to allow caller to synchronize phone changes
    container.syncPhone = (newPhone) => {
        const trimmed = (newPhone || '').trim();
        if (application && initialPhone && trimmed !== initialPhone) {
            // Phone changed: old consent cannot carry over automatically
            currentPreference.requiresReconsent = true;
            checkbox.checked = false;
            updateNotices();
            onPreferenceChange?.(false);
        }
    };

    // Helper to get pending user preference for when draft is saved
    container.getUserPreference = () => checkbox.checked;

    // Helper to refresh on locale change without calling PUT
    container.refreshLocale = () => {
        const activeMessages = readMessages(document);
        textSpan.textContent = activeMessages.whatsappConsentLabel;
        explanation.textContent = activeMessages.whatsappConsentExplanation;
        updateNotices();
    };

    container.append(label, explanation, notice, status);
    return container;
}

/**
 * Mounts the notification preference management card in the applicant tracking view (/basvurum).
 * Only renders controls for the authenticated owner session; validates application ID.
 * @param {HTMLElement} mountPoint Mount container.
 * @param {object} options Application context, API and callbacks.
 * @returns {Promise<HTMLElement|null>} Rendered card or null if not applicable.
 */
export async function mountTrackingNotificationPreferences(mountPoint, {
    application,
    api,
    locale = 'tr',
    initialPreference = null,
    onPreferenceChange = null
} = {}) {
    if (!mountPoint || !application || !api?.readCurrentNotificationPreferences) return null;
    const document = mountPoint.ownerDocument;
    const messages = readMessages(document);

    const section = document.createElement('section');
    section.className = 'tracking-state tracking-notification-preferences';

    const heading = createTranslatedElement(document, 'h2', 'whatsappPreferencesHeading', messages.whatsappPreferencesHeading);
    const statusText = document.createElement('p');
    statusText.className = 'tracking-notification-status';

    const feedback = document.createElement('p');
    feedback.className = 'tracking-message';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'application-button';
    button.style.display = 'none';

    section.append(heading, statusText, button, feedback);
    mountPoint.append(section);

    let preference = initialPreference ? parseNotificationPreferences(initialPreference) : null;
    let isSubmitting = false;
    let inFlightController = null;

    function renderState() {
        const activeMessages = readMessages(document);
        heading.textContent = activeMessages.whatsappPreferencesHeading;

        if (!preference) {
            statusText.textContent = activeMessages.trackingLoading;
            button.style.display = 'none';
            return;
        }

        // Application ID mismatch check: do not expose management controls if IDs conflict
        if (preference.applicationId && application.id && preference.applicationId !== application.id) {
            statusText.textContent = '';
            button.style.display = 'none';
            feedback.style.display = '';
            feedback.setAttribute('role', 'alert');
            feedback.textContent = activeMessages.trackingLookupError;
            return;
        }

        if (preference.canOptIn === false) {
            statusText.textContent = activeMessages.whatsappPhoneRequired;
            button.style.display = 'none';
            return;
        }

        if (preference.requiresReconsent) {
            statusText.textContent = activeMessages.whatsappReconsentRequired;
            button.className = 'application-button application-button-primary';
            button.textContent = activeMessages.whatsappOptInAction;
            button.style.display = '';
            button.dataset.action = 'opt-in';
            return;
        }

        if (preference.effectiveWhatsappOptIn) {
            statusText.textContent = activeMessages.whatsappOptInActive;
            button.className = 'application-button application-button-secondary';
            button.textContent = activeMessages.whatsappOptOutAction;
            button.style.display = '';
            button.dataset.action = 'opt-out';
            return;
        }

        // Opted out
        statusText.textContent = activeMessages.whatsappOptOutActive;
        button.className = 'application-button application-button-primary';
        button.textContent = activeMessages.whatsappOptInAction;
        button.style.display = '';
        button.dataset.action = 'opt-in';
    }

    if (preference) {
        renderState();
    }

    async function loadPreferences() {
        try {
            const raw = await api.readCurrentNotificationPreferences();
            if (!section.isConnected) return;
            preference = parseNotificationPreferences(raw);
            onPreferenceChange?.(preference);
            renderState();
        } catch (error) {
            if (!section.isConnected) return;
            const activeMessages = readMessages(document);
            statusText.textContent = '';
            feedback.style.display = '';
            feedback.setAttribute('role', 'alert');
            feedback.textContent = resolveErrorMessage(activeMessages, error);
        }
    }

    button.addEventListener('click', async () => {
        if (isSubmitting || !preference) return;
        const isOptIn = button.dataset.action === 'opt-in';

        inFlightController?.abort();
        inFlightController = new AbortController();
        const currentController = inFlightController;

        isSubmitting = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');

        const activeMessages = readMessages(document);
        feedback.style.display = '';
        feedback.removeAttribute('role');
        feedback.setAttribute('role', 'status');
        feedback.textContent = activeMessages.whatsappPreferenceSaving;

        try {
            const activeLocale = document.documentElement.lang || 'tr';
            const payload = isOptIn
                ? { whatsapp_opt_in: true, consent_version: WHATSAPP_CONSENT_VERSION, language: activeLocale }
                : { whatsapp_opt_in: false };

            const response = await api.updateCurrentNotificationPreferences(payload);
            if (currentController.signal.aborted || !section.isConnected) return;

            preference = parseNotificationPreferences(response);
            onPreferenceChange?.(preference);
            feedback.textContent = activeMessages.whatsappPreferenceSaved;
            renderState();
        } catch (error) {
            if (currentController.signal.aborted || !section.isConnected) return;
            feedback.setAttribute('role', 'alert');
            feedback.textContent = resolveErrorMessage(activeMessages, error);
        } finally {
            if (inFlightController === currentController) {
                isSubmitting = false;
                inFlightController = null;
                button.disabled = false;
                button.setAttribute('aria-busy', 'false');
            }
        }
    });

    const localeListener = () => {
        if (!section.isConnected) {
            document.removeEventListener('public:locale-changed', localeListener);
            return;
        }
        renderState();
    };
    document.addEventListener('public:locale-changed', localeListener);

    await loadPreferences();
    return section;
}
