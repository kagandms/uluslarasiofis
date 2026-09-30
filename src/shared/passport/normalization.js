/**
 * Normalizes one OCR line so MRZ separators survive common OCR punctuation noise.
 * @param {string} line OCR text line.
 * @returns {string} Uppercase MRZ characters without whitespace or non-MRZ noise.
 */
export function normalizeMrzLine(line) {
    return line.normalize('NFKC')
        .toUpperCase()
        .replace(/[«‹()[\]{}]/g, '<')
        .replace(/[^A-Z0-9<]/g, '');
}

/**
 * Applies common OCR substitutions only where an MRZ date requires digits.
 * @param {string} value Six-character MRZ date candidate.
 * @returns {string} Date candidate with recognized OCR digit substitutions.
 */
export function normalizeMrzDateDigits(value) {
    return value.replace(/[OQ]/g, '0')
        .replace(/[IL|]/g, '1')
        .replace(/Z/g, '2')
        .replace(/S/g, '5')
        .replace(/B/g, '8');
}
