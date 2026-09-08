const MONTH_ALIASES = {
    jan: 1, january: 1, ocak: 1,
    feb: 2, february: 2, subat: 2,
    mar: 3, march: 3, mart: 3,
    apr: 4, april: 4, nisan: 4,
    may: 5, mayis: 5,
    jun: 6, june: 6, haziran: 6,
    jul: 7, july: 7, temmuz: 7,
    aug: 8, august: 8, agustos: 8,
    sep: 9, sept: 9, september: 9, eylul: 9,
    oct: 10, october: 10, ekim: 10,
    nov: 11, november: 11, kasim: 11,
    dec: 12, december: 12, aralik: 12
};

const MONTH_PATTERN = Object.keys(MONTH_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join('|');
const DATE_PATTERN = `(?:\\d{1,4}(?:[./-]\\d{1,4}){2}|\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{2,4}|(?:${MONTH_PATTERN})\\s+\\d{1,2},?\\s+\\d{2,4}|\\d{1,2}\\s+\\d{1,2}\\s+\\d{2,4}|\\d{6,8})`;

function normalizeDocumentText(text) {
    return (text || '')
        .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDateText(text) {
    return normalizeDocumentText(text)
        .replace(/[–—]/g, '-')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeYear(value) {
    const year = Number(value);
    if (!Number.isInteger(year)) return 0;
    if (String(value).length === 2) return year <= 49 ? 2000 + year : 1900 + year;
    return year;
}

function createDateValue(year, month, day) {
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return '';
    }
    return date.toISOString().slice(0, 10);
}

function parseDateValue(value) {
    const normalized = normalizeDateText(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const monthDate = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/)
        || normalized.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
    if (monthDate) {
        const isDayFirst = /^\d/.test(monthDate[1]);
        const day = Number(isDayFirst ? monthDate[1] : monthDate[2]);
        const month = MONTH_ALIASES[isDayFirst ? monthDate[2] : monthDate[1]];
        const year = normalizeYear(monthDate[3]);
        return createDateValue(year, month, day);
    }

    const compact = normalized.replace(/[^0-9]/g, '');
    const parts = normalized.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
        const [first, second, third] = parts;
        const isYearFirst = first.length === 4 || Number(first) > 31;
        const year = normalizeYear(isYearFirst ? first : third);
        const month = Number(second);
        const day = Number(isYearFirst ? third : first);
        return createDateValue(year, month, day);
    }

    if (compact.length === 8) {
        const firstFour = Number(compact.slice(0, 4));
        const isYearFirst = firstFour >= 1900 && firstFour <= 2100;
        const year = normalizeYear(isYearFirst ? compact.slice(0, 4) : compact.slice(4));
        const month = Number(isYearFirst ? compact.slice(4, 6) : compact.slice(2, 4));
        const day = Number(isYearFirst ? compact.slice(6) : compact.slice(0, 2));
        return createDateValue(year, month, day);
    }

    if (compact.length === 6) {
        return createDateValue(
            normalizeYear(compact.slice(4)),
            Number(compact.slice(2, 4)),
            Number(compact.slice(0, 2))
        );
    }
    return '';
}

function findLabeledDate(text, labels) {
    const normalizedText = normalizeDateText(text);
    for (const label of labels) {
        const labelPattern = normalizeDateText(label)
            .split(/\s+/)
            .map((part) => part.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&'))
            .join('\\s*');
        const labelMatch = normalizedText.match(new RegExp(labelPattern, 'i'));
        if (!labelMatch) continue;

        const start = (labelMatch.index || 0) + labelMatch[0].length;
        const dateWindow = normalizedText.slice(start, start + 100);
        const dateMatch = dateWindow.match(new RegExp(DATE_PATTERN, 'i'));
        const parsedDate = dateMatch ? parseDateValue(dateMatch[0]) : '';
        if (parsedDate) return parsedDate;
    }
    return '';
}

export function isValidYoksisId(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase().replace(/[–—]/g, '-');
    if (clean.includes('SVG') || clean.includes('ICON') || clean.includes('BTN') || clean.includes('BADGE')) return false;
    if (clean.startsWith('202') || clean.startsWith('19')) return false;
    if (!/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(clean)) return false;
    return /\d/.test(clean);
}

export function extractYoksisIdFromText(text) {
    const normalizedText = normalizeDocumentText(text);
    const labeledMatch = normalizedText.match(
        /(?:YÖKS[İI]S|YOKSIS|KABUL\s*MEKTUB[U]?|ACCEPTANCE\s*LETTER|VERIFICATION)\s*(?:ID|KODU|NO|CODE)?\s*[:#\.\-–—]?\s*([A-Z0-9]{2,4}\s*(?:[-–—]\s*[A-Z0-9]{2,4}){1,4})/i
    );
    if (labeledMatch) {
        const id = labeledMatch[1].replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
        if (isValidYoksisId(id)) {
            return id;
        }
    }

    const nearYoksisMatch = normalizedText.match(
        /(?:YÖKS[İI]S|YOKSIS)[^A-Z0-9]{1,30}?([A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4})/i
    );
    if (nearYoksisMatch) {
        const id = nearYoksisMatch[1].replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
        if (isValidYoksisId(id)) {
            return id;
        }
    }

    const candidates = normalizedText.match(/\b[A-Z0-9]{2,4}(?:\s*[-–—]\s*[A-Z0-9]{2,4}){2}\b/gi) || [];
    for (const candidate of candidates) {
        const cleaned = candidate.replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
        if (isValidYoksisId(cleaned)) {
            return cleaned;
        }
    }
    return '';
}

export function extractPassportDatesFromText(text) {
    const normalizedText = normalizeDocumentText(text);
    const issueDate = findLabeledDate(normalizedText, [
        'date of issue',
        'date of issuance',
        'issue date',
        'date issued',
        'dateofissue',
        'passport issue date',
        'düzenlenme tarihi',
        'düzenleme tarihi',
        'pasaport veriliş tarihi',
        'belge düzenlenme tarihi',
        'belgenin düzenlenme tarihi',
        'veriliş tarihi'
    ]);
    const expiryDate = findLabeledDate(normalizedText, [
        'date of expiry',
        'expiry date',
        'date of expiration',
        'expiration date',
        'passport expiry date',
        'date valid until',
        'valid until',
        'geçerlilik tarihi',
        'pasaport geçerlilik tarihi',
        'belgenin geçerlilik tarihi',
        'son kullanma tarihi',
        'son geçerlilik tarihi'
    ]);

    if (!issueDate || !expiryDate || issueDate > expiryDate || issueDate > new Date().toISOString().slice(0, 10)) {
        return { issueDate: '', expiryDate: '' };
    }
    return { issueDate, expiryDate };
}
