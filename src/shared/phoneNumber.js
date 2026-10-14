import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Removes invisible copy/paste formatting without removing meaningful phone characters.
 * @param {unknown} phoneNumber Contact phone value.
 * @returns {string} Clean phone text, or empty text for a non-string input.
 */
export function normalizePhoneNumber(phoneNumber) {
    if (typeof phoneNumber !== 'string') return '';
    return phoneNumber.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, '').trim();
}

/** Validates international numbers using numbering-plan metadata; preserves country-less legacy values.
 * @param {unknown} phoneNumber Contact phone value.
 * @returns {boolean} Whether the value is a valid international or existing local phone format.
 */
export function isValidPhoneNumber(phoneNumber) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!/^\+?[\d\s().-]+$/.test(normalizedPhone)) return false;
    if (normalizedPhone.startsWith('+')) {
        return Boolean(parsePhoneNumberFromString(normalizedPhone, { extract: false })?.isValid());
    }
    // Existing records have no country column; their local numbers cannot be reinterpreted as Turkish.
    const digits = normalizedPhone.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
}
