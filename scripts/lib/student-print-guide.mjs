import { PRINT_GUIDE_MESSAGES } from '../../src/public/i18n/print-guide-messages.js';
import { translatePrintMessage } from '../../src/public/i18n/printMessages.js';

const LANGUAGE_NAMES = Object.freeze({ tr: 'Türkçe', tk: 'Türkmençe', ru: 'Русский', en: 'English', ar: 'العربية' });

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function buildLanguageSection(locale) {
    const translate = (key) => escapeHtml(translatePrintMessage(locale, key));
    const steps = Object.values(PRINT_GUIDE_MESSAGES[locale]).map((step) => `<li>${escapeHtml(step)}</li>`).join('');
    return `<section class="language-section" lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
        <h2><span>${LANGUAGE_NAMES[locale]}</span> ${translate('title')}</h2>
        <ol>${steps}</ol>
        <p class="limits">${translate('fileFormats')}</p>
    </section>`;
}

/**
 * Fills the printable template with local assets and the production print address.
 * @param {{template: string, printUrl: string, qrSvg: string, logo: string, latinFont: string, arabicFont: string}} options Poster inputs.
 * @returns {string} Standalone HTML with all five languages and no remote assets.
 * @throws {TypeError} When the print address is not a public HTTPS print route.
 */
export function buildStudentPrintGuideHtml(options) {
    const url = new URL(options.printUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/yazdir/' || url.search || url.hash || url.username || url.password) {
        throw new TypeError('A public HTTPS /yazdir/ address is required.');
    }
    const replacements = { printUrl: escapeHtml(url.href), qrSvg: options.qrSvg, logo: options.logo,
        latinFont: options.latinFont, arabicFont: options.arabicFont,
        languages: Object.keys(LANGUAGE_NAMES).map(buildLanguageSection).join('\n') };
    return options.template.replace(/\{\{(\w+)\}\}/g, (_placeholder, key) => replacements[key]);
}
