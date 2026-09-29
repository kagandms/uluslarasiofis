/**
 * Validates a phone number with optional international prefix and common visual separators.
 * @param {unknown} phoneNumber Contact phone value.
 * @returns {boolean} Whether the value contains 7 to 15 digits and no unsupported characters.
 */
export function isValidPhoneNumber(phoneNumber) {
    if (typeof phoneNumber !== 'string') return false;
    const normalizedPhone = phoneNumber.trim();
    if (!/^\+?[\d\s().-]+$/.test(normalizedPhone)) return false;
    const digits = normalizedPhone.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
}
