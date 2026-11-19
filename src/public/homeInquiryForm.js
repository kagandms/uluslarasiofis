import { INQUIRY_MESSAGES } from './i18n/inquiry-messages.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from './i18n/messages.js';
import { PILOT_UX_MESSAGES } from './i18n/pilotUxMessages.js';
import { createPhoneField, parsePhoneInput } from './phoneField.js';
import { OFFICIAL_NOTICE_URL } from './privacyNoticeModal.js';
import { isValidPhoneNumber } from '../shared/phoneNumber.js';

const INQUIRY_ENDPOINT = '/api/public/inquiries';
const EMAIL_PATTERN = /^[^\s@?#&%\/\\:;,<>"'()\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const activeControllers = new WeakMap();

function normalizeLocale(locale) {
    const candidate = String(locale || '').trim().toLowerCase();
    return SUPPORTED_LOCALES.includes(candidate) ? candidate : 'tr';
}

function readSharedMessages(locale) {
    return {
        ...(PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr),
        ...(SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr),
        ...(PILOT_UX_MESSAGES[locale] || PILOT_UX_MESSAGES.tr),
        ...(INQUIRY_MESSAGES[locale] || INQUIRY_MESSAGES.tr)
    };
}

function resolvePrivacyNoticeHref(document) {
    const existingHref = document.getElementById('home-privacy-notice')?.getAttribute('href');
    return typeof existingHref === 'string' && existingHref.trim() ? existingHref.trim() : OFFICIAL_NOTICE_URL;
}

function resolveFetcher(document, customFetcher) {
    if (typeof customFetcher === 'function') return customFetcher;
    const view = document?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function prefersReducedMotion(document) {
    return Boolean(document?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function createTextField(document, { id, name, labelKey, type = 'text', required = false, maxLength, autocomplete, dir }) {
    const label = document.createElement('label');
    label.className = 'application-form-field';
    label.htmlFor = id;

    const labelText = document.createElement('span');
    labelText.dataset.inquiryI18n = labelKey;
    label.append(labelText);

    const input = document.createElement('input');
    input.id = id;
    input.name = name;
    input.type = type;
    if (maxLength) input.maxLength = maxLength;
    if (autocomplete) input.autocomplete = autocomplete;
    if (dir) input.dir = dir;

    if (required) {
        const mark = document.createElement('span');
        mark.className = 'field-required-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = ' *';
        label.append(mark);
        input.required = true;
        input.setAttribute('aria-required', 'true');
    }

    label.append(input);
    return { label, input };
}

function createMessageField(document) {
    const label = document.createElement('label');
    label.className = 'application-form-field inquiry-field-full';
    label.htmlFor = 'inquiry-message';

    const labelText = document.createElement('span');
    labelText.dataset.inquiryI18n = 'inquiryMessage';

    const mark = document.createElement('span');
    mark.className = 'field-required-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = ' *';

    const textarea = document.createElement('textarea');
    textarea.id = 'inquiry-message';
    textarea.name = 'message';
    textarea.rows = 4;
    textarea.minLength = 5;
    textarea.maxLength = 1000;
    textarea.required = true;
    textarea.setAttribute('aria-required', 'true');
    textarea.setAttribute('aria-describedby', 'inquiry-message-hint');

    const meta = document.createElement('div');
    meta.className = 'inquiry-message-meta';

    const hint = document.createElement('small');
    hint.id = 'inquiry-message-hint';
    hint.className = 'inquiry-field-hint';
    hint.dataset.inquiryI18n = 'inquiryMessageHint';

    const counter = document.createElement('small');
    counter.className = 'inquiry-message-counter';
    counter.textContent = '0 / 1000';

    meta.append(hint, counter);
    label.append(labelText, mark, textarea, meta);
    return { label, textarea, counter };
}

function createHoneypotField(document) {
    const wrapper = document.createElement('div');
    wrapper.className = 'inquiry-honeypot';
    wrapper.setAttribute('aria-hidden', 'true');

    const label = document.createElement('label');
    label.htmlFor = 'inquiry-website';
    label.textContent = 'Website';

    const input = document.createElement('input');
    input.id = 'inquiry-website';
    input.name = 'website';
    input.type = 'text';
    input.tabIndex = -1;
    input.autocomplete = 'off';

    wrapper.append(label, input);
    return { wrapper, input };
}

function resolveValidatedPhone(phoneContainer) {
    const visibleInput = phoneContainer.querySelector('[data-phone-visible]');
    const countrySelect = phoneContainer.querySelector('select[name="phone_country"]');
    const canonicalInput = phoneContainer.querySelector('input[name="student_phone"]');
    const rawValue = visibleInput?.value || '';
    if (!rawValue.trim()) return { valid: false, phone: '', focusTarget: visibleInput };

    const selectedCountry = countrySelect?.value || 'TR';
    const canonicalValue = canonicalInput?.value || '';
    if (canonicalInput?.dataset.phonePossible === 'true' && isValidPhoneNumber(canonicalValue)) {
        return { valid: true, phone: canonicalValue, focusTarget: visibleInput };
    }

    const parsed = parsePhoneInput(rawValue, selectedCountry);
    if (parsed.isPossible && isValidPhoneNumber(parsed.e164)) {
        return { valid: true, phone: parsed.e164, focusTarget: visibleInput };
    }

    return { valid: false, phone: '', focusTarget: visibleInput };
}

/**
 * Mounts and manages the public "Sorunuz mu var?" inquiry form inside the given section.
 * @param {HTMLElement} rootElement Target section element (e.g. `#questions`).
 * @param {{locale?: string, fetcher?: typeof fetch}} [options] Initial locale and optional fetch override.
 * @returns {{setLocale: (nextLocale: string) => void, destroy: () => void}|null} Controller handle.
 */
export function initHomeInquiryForm(rootElement, { locale, fetcher } = {}) {
    if (!rootElement) return null;

    const existing = activeControllers.get(rootElement);
    if (existing) existing.destroy();

    const document = rootElement.ownerDocument;
    let activeLocale = normalizeLocale(locale || document.documentElement?.lang);
    let isSubmitting = false;
    let feedbackState = { type: 'idle', messageKey: '' };

    const heading = document.createElement('h2');
    heading.id = 'questions-heading';
    heading.dataset.inquiryI18n = 'inquiryHeading';

    const intro = document.createElement('p');
    intro.className = 'public-section-intro';
    intro.dataset.inquiryI18n = 'inquiryIntro';

    const form = document.createElement('form');
    form.id = 'home-inquiry-form';
    form.className = 'inquiry-form';
    form.noValidate = true;

    const firstNameField = createTextField(document, {
        id: 'inquiry-first-name',
        name: 'first_name',
        labelKey: 'inquiryFirstName',
        required: true,
        maxLength: 60,
        autocomplete: 'given-name'
    });
    const lastNameField = createTextField(document, {
        id: 'inquiry-last-name',
        name: 'last_name',
        labelKey: 'inquiryLastName',
        required: true,
        maxLength: 60,
        autocomplete: 'family-name'
    });

    const phoneContainer = document.createElement('div');
    phoneContainer.className = 'inquiry-phone-slot inquiry-field-full';

    const emailField = createTextField(document, {
        id: 'inquiry-email',
        name: 'email',
        labelKey: 'inquiryEmail',
        type: 'email',
        required: false,
        maxLength: 254,
        autocomplete: 'email',
        dir: 'ltr'
    });
    emailField.label.classList.add('inquiry-field-full');

    const messageField = createMessageField(document);
    const honeypot = createHoneypotField(document);

    const actions = document.createElement('div');
    actions.className = 'inquiry-actions inquiry-field-full';

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'application-button application-button-primary inquiry-submit';
    actions.append(submitButton);

    const privacyNote = document.createElement('p');
    privacyNote.className = 'inquiry-privacy-note inquiry-field-full';
    const privacyPrefix = document.createElement('span');
    privacyPrefix.dataset.inquiryI18n = 'inquiryPrivacyPrefix';
    const privacyLink = document.createElement('a');
    privacyLink.className = 'inquiry-privacy-link';
    privacyLink.href = resolvePrivacyNoticeHref(document);
    privacyLink.target = '_blank';
    privacyLink.rel = 'noopener noreferrer';
    privacyLink.dataset.inquiryI18n = 'inquiryPrivacyLink';
    privacyNote.append(privacyPrefix, ' ', privacyLink);

    const feedbackBox = document.createElement('div');
    feedbackBox.id = 'inquiry-feedback';
    feedbackBox.className = 'inquiry-feedback inquiry-field-full';
    feedbackBox.setAttribute('role', 'status');
    feedbackBox.setAttribute('aria-live', 'polite');
    feedbackBox.hidden = true;
    const feedbackText = document.createElement('p');
    feedbackText.id = 'inquiry-feedback-message';
    feedbackText.className = 'inquiry-feedback-message';
    feedbackBox.append(feedbackText);

    form.append(
        firstNameField.label,
        lastNameField.label,
        phoneContainer,
        emailField.label,
        messageField.label,
        honeypot.wrapper,
        actions,
        privacyNote,
        feedbackBox
    );

    rootElement.replaceChildren(heading, intro, form);

    function mountPhoneField(nextLocale, { preserveValue = false } = {}) {
        const existingVisible = phoneContainer.querySelector('[data-phone-visible]');
        const existingCountry = phoneContainer.querySelector('select[name="phone_country"]');
        const previousValue = preserveValue ? (existingVisible?.value || '') : '';
        const previousCountry = preserveValue && existingCountry?.value ? existingCountry.value : 'TR';

        const field = createPhoneField(document, {
            value: '',
            locale: nextLocale,
            messages: readSharedMessages(nextLocale),
            country: previousCountry
        });
        phoneContainer.replaceChildren(field);

        if (preserveValue && previousValue) {
            const visibleInput = phoneContainer.querySelector('[data-phone-visible]');
            const countrySelect = phoneContainer.querySelector('select[name="phone_country"]');
            if (countrySelect && previousCountry) countrySelect.value = previousCountry;
            if (visibleInput) {
                visibleInput.value = previousValue;
                visibleInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
            }
        }
    }

    function updateMessageCounter() {
        const length = messageField.textarea.value.length;
        messageField.counter.textContent = `${length} / 1000`;
    }

    function renderFeedback() {
        const messages = INQUIRY_MESSAGES[activeLocale] || INQUIRY_MESSAGES.tr;
        if (feedbackState.type === 'idle' || !feedbackState.messageKey) {
            feedbackBox.hidden = true;
            delete feedbackBox.dataset.feedbackType;
            feedbackBox.setAttribute('role', 'status');
            feedbackText.textContent = '';
            return;
        }
        feedbackBox.hidden = false;
        feedbackBox.dataset.feedbackType = feedbackState.type;
        feedbackBox.setAttribute('role', feedbackState.type === 'error' ? 'alert' : 'status');
        feedbackText.textContent = messages[feedbackState.messageKey] || '';
    }

    function setFeedback(type, messageKey) {
        feedbackState = { type, messageKey };
        renderFeedback();
    }

    function applyTranslations(nextLocale, { preservePhone = true } = {}) {
        activeLocale = normalizeLocale(nextLocale);
        const messages = INQUIRY_MESSAGES[activeLocale] || INQUIRY_MESSAGES.tr;

        rootElement.querySelectorAll('[data-inquiry-i18n]').forEach((element) => {
            const key = element.dataset.inquiryI18n;
            if (messages[key]) element.textContent = messages[key];
        });

        const ctaButton = document.getElementById('btn-home-questions');
        if (ctaButton) {
            const ctaKey = ctaButton.dataset.inquiryI18n || 'inquiryCta';
            ctaButton.textContent = messages[ctaKey] || messages.inquiryCta;
        }

        messageField.textarea.placeholder = messages.inquiryMessagePlaceholder;
        submitButton.textContent = isSubmitting ? messages.inquirySubmitting : messages.inquirySubmit;
        privacyLink.href = resolvePrivacyNoticeHref(document);

        mountPhoneField(activeLocale, { preserveValue: preservePhone });
        renderFeedback();
    }

    const handleLocaleChanged = () => {
        applyTranslations(document.documentElement?.lang || activeLocale, { preservePhone: true });
    };

    const handleCtaClick = (event) => {
        if (ctaButton?.tagName === 'A' && ctaButton.getAttribute('href') === '#questions') {
            event.preventDefault();
        }
        rootElement.scrollIntoView?.({
            behavior: prefersReducedMotion(document) ? 'auto' : 'smooth',
            block: 'start'
        });
        firstNameField.input.focus();
    };

    const ctaButton = document.getElementById('btn-home-questions');
    ctaButton?.addEventListener('click', handleCtaClick);
    document.addEventListener('public:locale-changed', handleLocaleChanged);
    messageField.textarea.addEventListener('input', updateMessageCounter);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) return;

        setFeedback('idle', '');
        const firstName = firstNameField.input.value.trim();
        const lastName = lastNameField.input.value.trim();
        const emailRaw = emailField.input.value.trim();
        const message = messageField.textarea.value.trim();
        const website = honeypot.input.value;

        if (firstName.length < 1 || firstName.length > 60) {
            setFeedback('error', 'inquiryFirstNameRequired');
            firstNameField.input.focus();
            return;
        }
        if (lastName.length < 1 || lastName.length > 60) {
            setFeedback('error', 'inquiryLastNameRequired');
            lastNameField.input.focus();
            return;
        }

        const phoneCheck = resolveValidatedPhone(phoneContainer);
        if (!phoneCheck.valid) {
            setFeedback('error', 'inquiryPhoneInvalid');
            phoneCheck.focusTarget?.setAttribute('aria-invalid', 'true');
            phoneCheck.focusTarget?.focus();
            return;
        }

        if (emailRaw && (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 254)) {
            setFeedback('error', 'inquiryEmailInvalid');
            emailField.input.focus();
            return;
        }

        if (message.length < 5 || message.length > 1000) {
            setFeedback('error', 'inquiryMessageInvalid');
            messageField.textarea.focus();
            return;
        }

        const fetchFn = resolveFetcher(document, fetcher);
        if (!fetchFn) {
            setFeedback('error', 'inquiryNetworkError');
            return;
        }

        isSubmitting = true;
        form.setAttribute('aria-busy', 'true');
        submitButton.disabled = true;
        submitButton.textContent = (INQUIRY_MESSAGES[activeLocale] || INQUIRY_MESSAGES.tr).inquirySubmitting;

        const payload = {
            first_name: firstName,
            last_name: lastName,
            phone: phoneCheck.phone,
            email: emailRaw || null,
            message,
            language: activeLocale,
            website
        };

        try {
            const response = await fetchFn(INQUIRY_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                form.reset();
                mountPhoneField(activeLocale, { preserveValue: false });
                updateMessageCounter();
                setFeedback('success', 'inquirySuccess');
                return;
            }

            if (response.status === 429) {
                setFeedback('error', 'inquiryRateLimited');
            } else if (response.status === 400) {
                setFeedback('error', 'inquiryValidationError');
            } else {
                setFeedback('error', 'inquirySubmitFailed');
            }
        } catch {
            setFeedback('error', 'inquiryNetworkError');
        } finally {
            isSubmitting = false;
            form.removeAttribute('aria-busy');
            submitButton.disabled = false;
            submitButton.textContent = (INQUIRY_MESSAGES[activeLocale] || INQUIRY_MESSAGES.tr).inquirySubmit;
        }
    });

    applyTranslations(activeLocale, { preservePhone: false });
    updateMessageCounter();

    const controller = {
        setLocale(nextLocale) {
            applyTranslations(nextLocale, { preservePhone: true });
        },
        destroy() {
            document.removeEventListener('public:locale-changed', handleLocaleChanged);
            ctaButton?.removeEventListener('click', handleCtaClick);
            activeControllers.delete(rootElement);
        }
    };
    activeControllers.set(rootElement, controller);
    return controller;
}
