import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import tr from 'i18n-iso-countries/langs/tr.json' with { type: 'json' };
import ru from 'i18n-iso-countries/langs/ru.json' with { type: 'json' };
import tk from 'i18n-iso-countries/langs/tk.json' with { type: 'json' };
import ar from 'i18n-iso-countries/langs/ar.json' with { type: 'json' };

[en, tr, ru, tk, ar].forEach((locale) => countries.registerLocale(locale));

const LOCALES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);
const TURK_COUNTRY_ALIASES = Object.freeze({
    TR: Object.freeze(['turk', 'türk', 'turkish', 'turkiye']),
    TM: Object.freeze(['turk', 'türk', 'turkmen', 'turkmenistan'])
});

function normalizeSearch(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
        .replace(/ı/gu, 'i').toLocaleLowerCase('en').trim();
}

const COUNTRY_INDEX = Object.freeze(Object.keys(countries.getAlpha2Codes()).sort().map((code) => {
    const names = Object.freeze(Object.fromEntries(LOCALES.map((locale) => [locale, getCountryName(code, locale)])));
    const aliases = TURK_COUNTRY_ALIASES[code] || [];
    return Object.freeze({
        code,
        names,
        searchTerms: Object.freeze([...Object.values(names), ...aliases].map(normalizeSearch))
    });
}));

/** @returns {readonly string[]} Supported public country-name locales. */
export function supportedCountryLocales() {
    return LOCALES;
}

/** @param {string} locale @returns {string} */
function resolveLocale(locale) {
    return LOCALES.includes(locale) ? locale : 'en';
}

/** @param {string} countryCode @param {string} locale @returns {string} */
export function getCountryName(countryCode, locale) {
    const code = String(countryCode || '').toUpperCase();
    return countries.getName(code, resolveLocale(locale), { select: 'official' })
        || countries.getName(code, 'en')
        || code;
}

/** @param {string} locale @returns {Array<{code: string, name: string}>} */
export function listNationalityCountries(locale) {
    const resolvedLocale = resolveLocale(locale);
    return COUNTRY_INDEX.map(({ code, names }) => ({ code, name: names[resolvedLocale] }));
}

/** @param {string} query @param {string} locale @param {number} limit @returns {Array<{code: string, name: string}>} */
export function searchNationalityCountries(query, locale, limit = 8) {
    const term = normalizeSearch(query);
    if (!term) return [];
    const resolvedLocale = resolveLocale(locale);
    return COUNTRY_INDEX.filter((country) => country.searchTerms.some((name) => name.includes(term)))
        .slice(0, Math.max(1, limit))
        .map(({ code, names }) => ({ code, name: names[resolvedLocale] }));
}
