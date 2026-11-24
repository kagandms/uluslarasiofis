const TURKISH_CHAR_MAP = Object.freeze({
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'I': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u'
});

function foldToAsciiLower(value) {
    return value
        .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (ch) => TURKISH_CHAR_MAP[ch] || ch)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function normalizeNamePart(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .trim()
        .split(/\s+/)
        .map((token) => foldToAsciiLower(token).replace(/[^a-z0-9]+/g, ''))
        .filter(Boolean)
        .join('_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Builds a safe ASCII student PDF filename in `isim_soyisim_pasaportno.pdf` form.
 * @param {{firstName?: string|null, lastName?: string|null, passportNumber?: string|null}} [details] Student identity fields.
 * @param {string} [extension] Target file extension without a leading dot.
 * @returns {string} Safe ASCII filename, falling back to `basvuru.<extension>` when all parts are empty.
 */
export function createStudentFilename(details = {}, extension = 'pdf') {
    const { firstName, lastName, passportNumber } = details || {};
    const parts = [firstName, lastName, passportNumber]
        .map(normalizeNamePart)
        .filter(Boolean);
    const stem = parts.join('_').replace(/^_+|_+$/g, '') || 'basvuru';
    const cleanExtension = String(extension ?? 'pdf')
        .replace(/^\.+/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '') || 'pdf';
    return `${stem}.${cleanExtension}`;
}
