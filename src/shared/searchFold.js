/**
 * Pure, locale-safe text folding and tokenization helpers for tolerant name search.
 * Safe for both Cloudflare Workers and browser bundles (no DOM dependencies).
 */

export const MAX_SEARCH_TOKENS = 6;

/**
 * Folds text for tolerant name matching:
 * - Applies Turkish-safe lowercasing (İ, I, ı -> i)
 * - Decomposes via NFD and strips combining diacritical marks (ç->c, ğ->g, ş->s, ö->o, ü->u, â->a, ä->a, ý->y, ň->n, ž->z, ...)
 * - Maps w -> v
 * - Collapses runs of non-letters/non-digits to a single ASCII space and trims
 *
 * Non-Latin scripts (e.g. Cyrillic, Arabic) preserve their base letters and are not transliterated.
 *
 * @param {unknown} value Raw search or name text.
 * @returns {string} Folded search text.
 */
export function foldSearchText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/[İI]/g, 'i')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/w/g, 'v')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/**
 * Splits folded search text into at most `MAX_SEARCH_TOKENS` (6) non-empty tokens.
 * @param {unknown} value Raw search or name text.
 * @returns {string[]} Folded search tokens.
 */
export function searchTokens(value) {
    const folded = foldSearchText(value);
    if (!folded) return [];
    return folded.split(' ').filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
}
