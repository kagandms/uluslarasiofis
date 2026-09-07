const DATE_PATTERN = '(\\d{1,4}[./-]\\d{1,2}[./-]\\d{1,4})';

function normalizeDocumentText(text) {
    return (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDateValue(value) {
    const parts = value.replace(/[.-]/g, '/').split('/').map(Number);
    if (parts.some((part) => !Number.isInteger(part))) return '';

    const [first, second, third] = parts;
    const year = first > 31 ? first : third;
    const month = first > 31 ? second : second;
    const day = first > 31 ? third : first;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return '';

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return '';
    }
    return date.toISOString().slice(0, 10);
}

function findLabeledDate(text, labels) {
    const labelPattern = labels.join('|');
    const expression = new RegExp(`(?:${labelPattern})[^0-9]{0,60}${DATE_PATTERN}`, 'i');
    const match = text.match(expression);
    return match ? parseDateValue(match[1]) : '';
}

export function isValidYoksisId(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase();
    if (clean.includes('SVG') || clean.includes('ICON') || clean.includes('BTN') || clean.includes('BADGE')) return false;
    if (clean.startsWith('202') || clean.startsWith('19')) return false;
    if (!/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(clean)) return false;
    return /\d/.test(clean);
}

export function extractYoksisIdFromText(text) {
    const normalizedText = normalizeDocumentText(text);
    const labeledMatch = normalizedText.match(
        /(?:YÖKS[İI]S|YOKSIS)\s*(?:ID|KODU|NO)?\s*[:#-]?\s*([A-Z0-9]{2,4}\s*(?:-\s*[A-Z0-9]{2,4}){1,4})/i
    );
    if (labeledMatch) {
        const id = labeledMatch[1].replace(/\s+/g, '').toUpperCase();
        if (isValidYoksisId(id)) {
            return id;
        }
    }

    const candidates = normalizedText.match(/\b[A-Z0-9]{2,4}(?:-[A-Z0-9]{2,4}){1,4}\b/gi) || [];
    for (const candidate of candidates) {
        const cleaned = candidate.replace(/\s+/g, '').toUpperCase();
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
        'issue date',
        'date issued',
        'düzenlenme tarihi',
        'veriliş tarihi'
    ]);
    const expiryDate = findLabeledDate(normalizedText, [
        'date of expiry',
        'expiry date',
        'date of expiration',
        'valid until',
        'geçerlilik tarihi',
        'son geçerlilik tarihi'
    ]);

    if (!issueDate || !expiryDate || issueDate > expiryDate || issueDate > new Date().toISOString().slice(0, 10)) {
        return { issueDate: '', expiryDate: '' };
    }
    return { issueDate, expiryDate };
}
