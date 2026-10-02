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
 * Normalizes and strictly verifies notification preferences response against the API contract.
 * @param {object|null} data Raw API response object.
 * @param {string|null} expectedApplicationId Expected application ID to match against.
 * @returns {object} Normalized preference descriptor with verification flags.
 */
export function parseNotificationPreferences(data, expectedApplicationId = null) {
    if (!data || typeof data !== 'object') {
        return {
            applicationId: null,
            whatsappOptIn: false,
            consentVersion: null,
            language: null,
            optedInAt: null,
            optedOutAt: null,
            currentConsentVersion: null,
            effectiveWhatsappOptIn: false,
            requiresReconsent: false,
            canOptIn: false,
            isValidContract: false,
            isApplicationIdMatch: false,
            isVersionSupported: false,
            isVerified: false
        };
    }

    const applicationId = typeof data.application_id === 'string' && data.application_id.trim().length > 0
        ? data.application_id.trim()
        : null;
    const currentConsentVersion = typeof data.current_consent_version === 'string' && data.current_consent_version.trim().length > 0
        ? data.current_consent_version.trim()
        : null;
    const effectiveWhatsappOptIn = typeof data.effective_whatsapp_opt_in === 'boolean'
        ? data.effective_whatsapp_opt_in
        : false;
    const requiresReconsent = typeof data.requires_reconsent === 'boolean'
        ? data.requires_reconsent
        : false;
    const canOptIn = typeof data.can_opt_in === 'boolean'
        ? data.can_opt_in
        : false;
    const whatsappOptIn = typeof data.whatsapp_opt_in === 'boolean'
        ? data.whatsapp_opt_in
        : false;
    const consentVersion = typeof data.consent_version === 'string' && data.consent_version.trim().length > 0
        ? data.consent_version.trim()
        : null;
    const language = typeof data.language === 'string' && data.language.trim().length > 0
        ? data.language.trim()
        : null;
    const optedInAt = typeof data.opted_in_at === 'string' && data.opted_in_at.trim().length > 0
        ? data.opted_in_at.trim()
        : null;
    const optedOutAt = typeof data.opted_out_at === 'string' && data.opted_out_at.trim().length > 0
        ? data.opted_out_at.trim()
        : null;

    // Strict contract completeness: all backend-added fields must be present and correctly typed
    const hasRequiredTypes = applicationId !== null
        && currentConsentVersion !== null
        && typeof data.effective_whatsapp_opt_in === 'boolean'
        && typeof data.requires_reconsent === 'boolean'
        && typeof data.can_opt_in === 'boolean'
        && typeof data.whatsapp_opt_in === 'boolean';

    // Application ID validation: missing ID or mismatch is a verification failure
    let isApplicationIdMatch = false;
    if (expectedApplicationId !== null && expectedApplicationId !== undefined) {
        isApplicationIdMatch = Boolean(applicationId && applicationId === expectedApplicationId);
    } else {
        isApplicationIdMatch = Boolean(applicationId);
    }

    // Supported consent text version match: cannot opt-in to or verify unknown text version
    const isVersionSupported = (currentConsentVersion === WHATSAPP_CONSENT_VERSION);

    // Coherence check: active effective opt-in requires opt-in flag, matching consent version, no re-consent, and canOptIn
    let isCoherent = true;
    if (effectiveWhatsappOptIn) {
        if (!whatsappOptIn || consentVersion !== currentConsentVersion || requiresReconsent || !canOptIn) {
            isCoherent = false;
        }
    }

    const isValidContract = hasRequiredTypes && isCoherent && (expectedApplicationId ? isApplicationIdMatch : true);
    const isVerified = isValidContract && isApplicationIdMatch && isVersionSupported;

    return {
        applicationId,
        whatsappOptIn,
        consentVersion,
        language,
        optedInAt,
        optedOutAt,
        currentConsentVersion,
        effectiveWhatsappOptIn: isVerified ? effectiveWhatsappOptIn : false,
        requiresReconsent,
        canOptIn,
        isValidContract,
        isApplicationIdMatch,
        isVersionSupported,
        isVerified
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
 * @param {object} options Configuration, initial values, and callbacks.
 * @returns {HTMLElement} Container with preference checkbox and accessible guidance.
 */
export function createNotificationPreferenceField(document, {
    application = null,
    initialPreference = null,
    formValues = null,
    api = null,
    onPreferenceChange = null,
    persistPhone = null
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

    let currentPreference = initialPreference ? parseNotificationPreferences(initialPreference, application?.id) : null;
    let currentPhone = (application?.student_phone || formValues?.student_phone || '').trim();
    let lastSyncedPhone = currentPhone;
    let userReconsentedPhone = null;
    let saveGeneration = 0;
    let inFlightController = null;

    // Determine initial checked state:
    // 1. Unauthenticated visitor: temporary intent (default unchecked unless formValues.whatsapp_opt_in is set)
    // 2. Authenticated draft: use explicit formValues if set, otherwise verified effective preference without reconsent
    if (!application) {
        checkbox.checked = Boolean(formValues && formValues.whatsapp_opt_in === true);
    } else if (formValues && typeof formValues.whatsapp_opt_in === 'boolean') {
        checkbox.checked = formValues.whatsapp_opt_in;
    } else if (currentPreference?.isVerified && currentPreference.effectiveWhatsappOptIn && !currentPreference.requiresReconsent) {
        checkbox.checked = true;
    } else {
        checkbox.checked = false;
    }

    function updateNotices() {
        const activeMessages = readMessages(document);
        // Pre-session visitor: never restrict or disable controls
        if (!application) {
            checkbox.disabled = false;
            notice.style.display = 'none';
            notice.textContent = '';
            return;
        }

        // Authenticated session: verify contract
        if (currentPreference && !currentPreference.isValidContract) {
            checkbox.disabled = true;
            notice.dataset.i18n = 'whatsappPreferenceFailed';
            notice.textContent = activeMessages.whatsappPreferenceFailed;
            notice.style.display = '';
            return;
        }

        if (currentPreference && !currentPreference.isVersionSupported) {
            checkbox.disabled = true;
            notice.dataset.i18n = 'whatsappPreferenceVersionInvalid';
            notice.textContent = activeMessages.whatsappPreferenceVersionInvalid;
            notice.style.display = '';
            return;
        }

        if (currentPreference && currentPreference.canOptIn === false) {
            checkbox.disabled = true;
            notice.dataset.i18n = 'whatsappPhoneRequired';
            notice.textContent = activeMessages.whatsappPhoneRequired;
            notice.style.display = '';
            return;
        }

        checkbox.disabled = false;
        if (currentPreference && currentPreference.requiresReconsent) {
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

        const thisGen = ++saveGeneration;
        const phoneAtStart = currentPhone;
        const activeMessages = readMessages(document);

        // Prevent rapid conflicting clicks during in-flight operations
        checkbox.disabled = true;
        status.style.display = '';
        status.removeAttribute('role');
        status.setAttribute('role', 'status');
        status.dataset.i18n = 'whatsappPreferenceSaving';
        status.textContent = activeMessages.whatsappPreferenceSaving;

        if (optIn) {
            // STEP 1: Persist phone changes first so server application has the updated phone
            if (typeof persistPhone === 'function') {
                const phoneResult = await persistPhone();
                if (thisGen !== saveGeneration || currentPhone !== phoneAtStart) {
                    // Phone was modified again during persist; abort this stale save
                    return;
                }
                if (!phoneResult?.success) {
                    // Phone save failed: DO NOT send opt-in PUT
                    checkbox.disabled = false;
                    status.setAttribute('role', 'alert');
                    status.dataset.i18n = 'whatsappPreferenceFailed';
                    status.textContent = activeMessages.whatsappPreferenceFailed;
                    return;
                }
                if (phoneResult.application) application = phoneResult.application;
            }

            // STEP 2: Verify version and phone availability
            if (currentPreference && !currentPreference.isVersionSupported) {
                checkbox.disabled = true;
                status.setAttribute('role', 'alert');
                status.dataset.i18n = 'whatsappPreferenceVersionInvalid';
                status.textContent = activeMessages.whatsappPreferenceVersionInvalid;
                return;
            }

            if (!currentPhone) {
                checkbox.disabled = true;
                status.setAttribute('role', 'alert');
                status.dataset.i18n = 'whatsappPhoneRequired';
                status.textContent = activeMessages.whatsappPhoneRequired;
                return;
            }

            // STEP 3: Send preference opt-in PUT
            inFlightController?.abort();
            inFlightController = new AbortController();
            let response;
            try {
                const activeLocale = document.documentElement.lang || 'tr';
                response = await api.updateCurrentNotificationPreferences({
                    whatsapp_opt_in: true,
                    consent_version: WHATSAPP_CONSENT_VERSION,
                    language: activeLocale
                });
            } catch (error) {
                if (thisGen !== saveGeneration || currentPhone !== phoneAtStart) return;
                checkbox.disabled = false;
                status.setAttribute('role', 'alert');
                status.textContent = resolveErrorMessage(activeMessages, error);
                return;
            }

            // STEP 4: Guard against phone change while request was in-flight
            if (thisGen !== saveGeneration || currentPhone !== phoneAtStart) {
                // Phone changed while PUT was in flight: discard response!
                return;
            }

            // STEP 5: Validate response contract before declaring success
            const parsed = parseNotificationPreferences(response, application?.id);
            if (!parsed.isValidContract || !parsed.effectiveWhatsappOptIn || !parsed.isVersionSupported) {
                checkbox.disabled = false;
                status.setAttribute('role', 'alert');
                status.textContent = !parsed.isVersionSupported
                    ? activeMessages.whatsappPreferenceVersionInvalid
                    : activeMessages.whatsappPreferenceFailed;
                return;
            }

            currentPreference = parsed;
            checkbox.disabled = false;
            status.dataset.i18n = 'whatsappPreferenceSaved';
            status.textContent = activeMessages.whatsappPreferenceSaved;
            updateNotices();
        } else {
            // Opt-out path: send { whatsapp_opt_in: false }
            inFlightController?.abort();
            inFlightController = new AbortController();
            let response;
            try {
                response = await api.updateCurrentNotificationPreferences({
                    whatsapp_opt_in: false
                });
            } catch (error) {
                if (thisGen !== saveGeneration) return;
                checkbox.disabled = false;
                status.setAttribute('role', 'alert');
                status.textContent = resolveErrorMessage(activeMessages, error);
                return;
            }

            if (thisGen !== saveGeneration) return;

            const parsed = parseNotificationPreferences(response, application?.id);
            currentPreference = parsed;
            checkbox.disabled = false;
            status.dataset.i18n = 'whatsappPreferenceSaved';
            status.textContent = activeMessages.whatsappPreferenceSaved;
            updateNotices();
        }
    }

    checkbox.addEventListener('change', () => {
        const isChecked = checkbox.checked;
        if (isChecked) {
            userReconsentedPhone = currentPhone;
        }
        onPreferenceChange?.(isChecked);
        if (application && api) {
            void savePreference(isChecked);
        }
    });

    // Helper attached to container to synchronize phone input changes
    container.syncPhone = (newPhone) => {
        const trimmed = (newPhone || '').trim();
        if (trimmed === lastSyncedPhone) return;
        lastSyncedPhone = trimmed;
        currentPhone = trimmed;

        // Invalidate in-flight save operations
        saveGeneration++;

        if (application) {
            const savedPhone = (application.student_phone || '').trim();
            if (trimmed !== savedPhone) {
                // Phone differs from confirmed server record: invalidate old consent
                if (currentPreference) {
                    currentPreference.requiresReconsent = true;
                }
                checkbox.checked = false;
                userReconsentedPhone = null;
                updateNotices();
                onPreferenceChange?.(false);
            } else {
                // Phone reverted to saved phone
                updateNotices();
            }
        }
    };

    container.getUserPreference = () => checkbox.checked;

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
 * Only renders controls for the authenticated owner session; validates application ID and contract.
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

    let preference = initialPreference ? parseNotificationPreferences(initialPreference, application?.id) : null;
    let isSubmitting = false;
    let saveGeneration = 0;
    let inFlightController = null;

    function renderState() {
        const activeMessages = readMessages(document);
        heading.textContent = activeMessages.whatsappPreferencesHeading;

        if (!preference) {
            statusText.textContent = activeMessages.trackingLoading;
            button.style.display = 'none';
            return;
        }

        // Contract and application ID verification: missing ID, mismatch, or broken contract blocks management
        if (!preference.isValidContract || !preference.isApplicationIdMatch) {
            statusText.textContent = '';
            button.style.display = 'none';
            feedback.style.display = '';
            feedback.setAttribute('role', 'alert');
            feedback.textContent = activeMessages.trackingLookupError;
            return;
        }

        // Unsupported or outdated consent version on server
        if (!preference.isVersionSupported) {
            statusText.textContent = activeMessages.whatsappPreferenceVersionInvalid;
            button.style.display = 'none';
            feedback.style.display = '';
            feedback.setAttribute('role', 'alert');
            feedback.textContent = activeMessages.whatsappPreferenceVersionInvalid;
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

        // Opted out state
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
            preference = parseNotificationPreferences(raw, application?.id);
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

        // Do not allow opt-in if server text version is not supported
        if (isOptIn && !preference.isVersionSupported) {
            const activeMessages = readMessages(document);
            feedback.style.display = '';
            feedback.setAttribute('role', 'alert');
            feedback.textContent = activeMessages.whatsappPreferenceVersionInvalid;
            return;
        }

        const thisGen = ++saveGeneration;
        inFlightController?.abort();
        inFlightController = new AbortController();

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
            if (thisGen !== saveGeneration || !section.isConnected) return;

            const parsed = parseNotificationPreferences(response, application?.id);
            if (!parsed.isValidContract || (isOptIn && !parsed.effectiveWhatsappOptIn)) {
                feedback.setAttribute('role', 'alert');
                feedback.textContent = !parsed.isVersionSupported
                    ? activeMessages.whatsappPreferenceVersionInvalid
                    : activeMessages.whatsappPreferenceFailed;
                return;
            }

            preference = parsed;
            onPreferenceChange?.(preference);
            feedback.textContent = activeMessages.whatsappPreferenceSaved;
            renderState();
        } catch (error) {
            if (thisGen !== saveGeneration || !section.isConnected) return;
            feedback.setAttribute('role', 'alert');
            feedback.textContent = resolveErrorMessage(activeMessages, error);
        } finally {
            if (thisGen === saveGeneration) {
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
