import { detectPrintLocale, PRINT_LOCALES } from './printMessages.js';

const LOCALE_STORAGE_KEY = 'print.locale.v2';

/**
 * Reads an explicit preference before falling back to browser languages.
 * @param {Window} view Browser window.
 * @returns {string} Supported printing locale.
 */
export function readPrintLocale(view) {
    try {
        const savedLocale = view.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (PRINT_LOCALES.includes(savedLocale)) return savedLocale;
    } catch (error) {
        view.console.warn('Print language preference could not be read.', error);
    }
    return detectPrintLocale(view.navigator.languages, view.navigator.language);
}

/**
 * Remembers a supported language; blocked storage does not stop printing.
 * @param {Window} view Browser window.
 * @param {string} locale Selected printing locale.
 * @returns {boolean} Whether the preference was saved.
 * @throws {RangeError} When the locale is unsupported.
 */
export function savePrintLocale(view, locale) {
    if (!PRINT_LOCALES.includes(locale)) throw new RangeError('Unsupported print language.');
    try {
        view.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        return true;
    } catch (error) {
        view.console.warn('Print language preference could not be saved.', error);
        return false;
    }
}
