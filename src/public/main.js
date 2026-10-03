import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from './i18n/messages.js';
import { initializeApplicationWizard } from './applicationWizard.js';
import { initializeApplicationTracking } from './applicationTracking.js';
import * as applicationApi from './applicationApi.js';
import { renderPublicDocumentOverview } from './home.js';
import { PILOT_UX_MESSAGES } from './i18n/pilotUxMessages.js';

const LOCALE_STORAGE_KEY = 'portal_ui_locale';
const FALLBACK_LOCALE = 'tr';

function readSavedLocale() {
    try {
        const savedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
        return SUPPORTED_LOCALES.includes(savedLocale) ? savedLocale : FALLBACK_LOCALE;
    } catch {
        return FALLBACK_LOCALE;
    }
}

function getMessage(locale, key) {
    return PILOT_UX_MESSAGES[locale]?.[key]
        ?? SESSION3_MESSAGES[locale]?.[key]
        ?? PUBLIC_MESSAGES[locale]?.[key]
        ?? PILOT_UX_MESSAGES[FALLBACK_LOCALE][key]
        ?? SESSION3_MESSAGES[FALLBACK_LOCALE][key]
        ?? PUBLIC_MESSAGES[FALLBACK_LOCALE][key]
        ?? key;
}

function applyLocale(locale) {
    const selectedLocale = SUPPORTED_LOCALES.includes(locale) ? locale : FALLBACK_LOCALE;
    const page = document.body.dataset.page;
    const isApplicationPage = page === 'application';
    const isTrackingPage = page === 'tracking';

    document.documentElement.lang = selectedLocale;
    document.documentElement.dir = selectedLocale === 'ar' ? 'rtl' : 'ltr';
    const titleKey = isApplicationPage
        ? 'applicationPageTitle'
        : (isTrackingPage ? 'trackingPageTitle' : 'portalTitle');
    document.title = getMessage(selectedLocale, titleKey);

    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const messageKey = element.dataset.i18n;
        element.textContent = getMessage(selectedLocale, messageKey);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        const messageKey = element.dataset.i18nAriaLabel;
        element.setAttribute('aria-label', getMessage(selectedLocale, messageKey));
    });

    const pageHeading = document.getElementById('page-heading');
    const pageDescription = document.getElementById('page-description');
    if (pageHeading && pageDescription && (isApplicationPage || isTrackingPage)) {
        pageHeading.textContent = getMessage(selectedLocale, isApplicationPage ? 'applicationPageTitle' : 'trackingPageTitle');
        pageDescription.textContent = getMessage(selectedLocale, isApplicationPage ? 'applicationPageText' : 'trackingPageText');
    }

    const localeSelect = document.getElementById('locale-select');
    if (localeSelect) localeSelect.value = selectedLocale;
    const documentOverview = document.getElementById('public-document-overview');
    if (documentOverview) renderPublicDocumentOverview(documentOverview, selectedLocale);
    const localeEvent = document.createEvent('Event');
    localeEvent.initEvent('public:locale-changed', false, false);
    document.dispatchEvent(localeEvent);
}

function initPublicPortal() {
    const localeSelect = document.getElementById('locale-select');
    localeSelect?.addEventListener('change', () => {
        const selectedLocale = localeSelect.value;
        applyLocale(selectedLocale);
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, selectedLocale);
        } catch {
            // The language still applies for this page view when storage is unavailable.
        }
    });

    applyLocale(readSavedLocale());
    if (document.body.dataset.page === 'application') {
        const wizardRoot = document.getElementById('application-wizard');
        if (wizardRoot) void initializeApplicationWizard(wizardRoot, applicationApi);
    }
    if (document.body.dataset.page === 'tracking') {
        const trackingRoot = document.getElementById('application-tracking');
        if (trackingRoot) void initializeApplicationTracking(trackingRoot, applicationApi);
    }
}

initPublicPortal();
