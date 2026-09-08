const MONTH_ALIASES = {
    // English
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
    // Turkish
    ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
    temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
    // French
    janv: 1, janvier: 1, fevr: 2, fevrier: 2, mars: 3, avr: 4, avril: 4,
    mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8, sept: 9, septembre: 9,
    octobre: 10, nov: 11, novembre: 11, decembre: 12,
    // Spanish
    ene: 1, enero: 1, febrero: 2, marzo: 3, abr: 4, abril: 4, mayo: 5,
    junio: 6, julio: 7, ago: 8, agosto: 8, setiembre: 9,
    octubre: 10, diciembre: 12,
    // German
    mrz: 3, maerz: 3, juni: 6, juli: 7, okt: 10, dez: 12, dezember: 12,
    // Russian (Cyrillic)
    янв: 1, фев: 2, мар: 3, апр: 4, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};

const MONTH_PATTERN = Object.keys(MONTH_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join('|');

const DATE_PATTERN = `(?:\\d{1,4}(?:[./-]\\d{1,4}){2}|\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{2,4}|(?:${MONTH_PATTERN})\\s+\\d{1,2},?\\s+\\d{2,4}|\\d{1,2}\\s*[-/]\\s*(?:${MONTH_PATTERN})\\s*[-/]\\s*\\d{2,4}|\\d{1,2}(?:${MONTH_PATTERN})\\d{2,4}|\\d{1,2}\\s+\\d{1,2}\\s+\\d{2,4}|\\d{6,8})`;

const ISSUE_DATE_LABELS = [
    // English
    'date of issue', 'date of issuance', 'issue date', 'date issued', 'dateofissue', 'passport issue date', 'issued on', 'date of delivery', 'issuing date', 'given on',
    // Turkish
    'düzenlenme tarihi', 'düzenleme tarihi', 'pasaport veriliş tarihi', 'belge düzenlenme tarihi', 'belgenin düzenlenme tarihi', 'veriliş tarihi', 'tanzim tarihi', 'verildiği tarih',
    // French
    'date de delivrance', 'date de délivrance', 'date d emission', "date d'emission", "date d'émission", 'delivre le', 'délivré le', 'delivree le', 'emise le',
    // Spanish
    'fecha de expedicion', 'fecha de expedición', 'fecha de emision', 'fecha de emisión', 'expedido el',
    // German
    'ausstellungsdatum', 'ausgestellt am',
    // Russian (transliterated / Cyrillic)
    'дата выдачи', 'выдан', 'data vydachi',
    // Arabic transliterated / keywords
    'tarikh al isdar', 'tarikh al-isdar', 'تاريخ الإصدار', 'تاريخ الاصدار'
];

const EXPIRY_DATE_LABELS = [
    // English
    'date of expiry', 'expiry date', 'date of expiration', 'expiration date', 'passport expiry date', 'date valid until', 'valid until', 'expires on', 'valid to', 'valid thru', 'valid through', 'date of expiry / date',
    // Turkish
    'geçerlilik tarihi', 'pasaport geçerlilik tarihi', 'belgenin geçerlilik tarihi', 'son kullanma tarihi', 'son geçerlilik tarihi', 'bitiş tarihi', 'gecerlilik suresi',
    // French
    'date d expiration', "date d'expiration", 'expire le', 'date de validite', 'date de validité', 'valable jusqu au', 'valable jusqu\'au',
    // Spanish
    'fecha de caducidad', 'fecha de expiracion', 'fecha de expiración', 'fecha de vencimiento', 'valido hasta', 'válido hasta',
    // German
    'gueltig bis', 'gültig bis', 'ablaufdatum',
    // Russian (transliterated / Cyrillic)
    'дата окончания', 'срок действия', 'действителен до', 'deystvitelen do', 'srok deystviya',
    // Arabic transliterated / keywords
    'tarikh al intiha', 'tarikh al-intiha', 'تاريخ الانتهاء', 'تاريخ الصلاحية'
];

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
        // Clean bilingual month slashes e.g. "MAR / MARS" -> "MAR", "MAY/MAI" -> "MAY"
        .replace(/\b([a-z]{3,4})\s*\/\s*[a-z]{3,6}\b/gi, '$1')
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

export function parseDateValue(value) {
    if (!value) return '';
    const normalized = normalizeDateText(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Month name with space, dash, or slash (e.g. "11 MAR 2025", "11-MAR-2025", "11/MAR/25")
    const monthClean = normalized.replace(/[-/]/g, ' ');
    const monthDate = monthClean.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/)
        || monthClean.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
    if (monthDate) {
        const isDayFirst = /^\d/.test(monthDate[1]);
        const day = Number(isDayFirst ? monthDate[1] : monthDate[2]);
        const month = MONTH_ALIASES[isDayFirst ? monthDate[2] : monthDate[1]];
        const year = normalizeYear(monthDate[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 2. Compact month without spaces (e.g. "11MAR2025" or "11MAR25")
    const compactMonth = normalized.match(/^(\d{1,2})([a-z]+)(\d{2,4})$/);
    if (compactMonth) {
        const day = Number(compactMonth[1]);
        const month = MONTH_ALIASES[compactMonth[2]];
        const year = normalizeYear(compactMonth[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 3. Year first with month (e.g. "2025 MAR 11")
    const yearMonthDate = monthClean.match(/^(\d{4})\s+([a-z]+)\s+(\d{1,2})$/);
    if (yearMonthDate) {
        const year = normalizeYear(yearMonthDate[1]);
        const month = MONTH_ALIASES[yearMonthDate[2]];
        const day = Number(yearMonthDate[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 4. Three numeric parts separated by ., /, -, or space
    const parts = normalized.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
        const [first, second, third] = parts;
        const isYearFirst = first.length === 4 || Number(first) > 31;
        const year = normalizeYear(isYearFirst ? first : third);
        const month = Number(second);
        const day = Number(isYearFirst ? third : first);
        return createDateValue(year, month, day);
    }

    // 5. Compact 8-digit (YYYYMMDD or DDMMYYYY)
    const compact = normalized.replace(/[^0-9]/g, '');
    if (compact.length === 8) {
        const firstFour = Number(compact.slice(0, 4));
        const isYearFirst = firstFour >= 1900 && firstFour <= 2100;
        const year = normalizeYear(isYearFirst ? compact.slice(0, 4) : compact.slice(4));
        const month = Number(isYearFirst ? compact.slice(4, 6) : compact.slice(2, 4));
        const day = Number(isYearFirst ? compact.slice(6) : compact.slice(0, 2));
        return createDateValue(year, month, day);
    }

    // 6. Compact 6-digit (DDMMYY)
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
            .join('\\s*[:#\\-\\.\\s]*');
        const labelMatch = normalizedText.match(new RegExp(labelPattern, 'i'));
        if (!labelMatch) continue;

        // 1. Search forward (after label)
        const start = (labelMatch.index || 0) + labelMatch[0].length;
        const dateWindowAfter = normalizedText.slice(start, start + 120);
        const dateMatchAfter = dateWindowAfter.match(new RegExp(DATE_PATTERN, 'i'));
        const parsedAfter = dateMatchAfter ? parseDateValue(dateMatchAfter[0]) : '';
        if (parsedAfter) return parsedAfter;

        // 2. Search backward (before label, for table cells / RTL layouts)
        const preStart = Math.max(0, (labelMatch.index || 0) - 70);
        const dateWindowBefore = normalizedText.slice(preStart, labelMatch.index || 0);
        const dateMatchesBefore = Array.from(dateWindowBefore.matchAll(new RegExp(DATE_PATTERN, 'ig')));
        if (dateMatchesBefore.length > 0) {
            const lastMatch = dateMatchesBefore[dateMatchesBefore.length - 1];
            const parsedBefore = parseDateValue(lastMatch[0]);
            if (parsedBefore) return parsedBefore;
        }
    }
    return '';
}

export function extractDatesFromMrz(text) {
    if (!text) return { issueDate: '', expiryDate: '', birthDate: '' };

    const lines = text.split(/[\r\n]+/)
        .map((line) => line.replace(/[\s\t]/g, '').toUpperCase())
        .filter((line) => line.length >= 28 && (line.includes('<') || line.startsWith('P')));

    for (const line of lines) {
        // Standard TD3 Line 2: [A-Z0-9<]{9}[0-9<][A-Z<]{3}(\d{6})[0-9<][MF<](\d{6})
        const m = line.match(/(?:[A-Z0-9<]{9})[0-9<][A-Z<]{3}(\d{6})[0-9<][MF<](\d{6})/i);
        if (m) {
            const birthRaw = m[1];
            const expRaw = m[2];

            const by = Number(birthRaw.slice(0, 2));
            const birthYear = by <= 49 ? 2000 + by : 1900 + by;
            const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

            const ey = Number(expRaw.slice(0, 2));
            const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
            const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

            return { issueDate: '', expiryDate, birthDate };
        }
    }
    return { issueDate: '', expiryDate: '', birthDate: '' };
}

function extractAllCandidateDates(text) {
    const normalizedText = normalizeDateText(text);
    const dateRegex = new RegExp(DATE_PATTERN, 'ig');
    const matches = Array.from(normalizedText.matchAll(dateRegex));
    const dates = [];
    const seen = new Set();

    for (const match of matches) {
        const parsed = parseDateValue(match[0]);
        if (parsed && !seen.has(parsed)) {
            seen.add(parsed);
            dates.push(parsed);
        }
    }
    return dates.sort();
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

export function extractPassportDatesFromText(text, options = {}) {
    const normalizedText = normalizeDocumentText(text);
    let issueDate = findLabeledDate(normalizedText, ISSUE_DATE_LABELS);
    let expiryDate = findLabeledDate(normalizedText, EXPIRY_DATE_LABELS);

    // If dates are swapped by incorrect label matching:
    if (issueDate && expiryDate && issueDate > expiryDate) {
        return { issueDate: '', expiryDate: '' };
    }

    // If either date is missing, attempt MRZ extraction:
    const mrz = extractDatesFromMrz(text);
    if (!expiryDate && mrz.expiryDate) {
        expiryDate = mrz.expiryDate;
    }

    // If still missing, check all candidate dates in document:
    if (!issueDate || !expiryDate) {
        const candidates = extractAllCandidateDates(text);
        const today = new Date().toISOString().slice(0, 10);
        const birthDate = options.birthDate || mrz.birthDate || '';

        // Filter out dates that are birth dates or too old (passports valid up to 10 years)
        const plausibleDates = candidates.filter((d) => {
            if (birthDate && d === birthDate) return false;
            if (d < '2012-01-01') return false; // Not a valid issue/expiry date for current students
            return true;
        });

        if (!expiryDate) {
            // Expiry date is usually the latest date, often in future
            const futureDates = plausibleDates.filter((d) => d >= today);
            if (futureDates.length > 0) {
                expiryDate = futureDates[futureDates.length - 1];
            } else if (plausibleDates.length > 0 && issueDate) {
                const afterIssue = plausibleDates.filter((d) => d > issueDate);
                if (afterIssue.length > 0) expiryDate = afterIssue[afterIssue.length - 1];
            }
        }

        if (!issueDate) {
            // Issue date is in the past and before expiry
            const pastDates = plausibleDates.filter((d) => d <= today && (!expiryDate || d < expiryDate));
            if (pastDates.length > 0) {
                issueDate = pastDates[pastDates.length - 1];
            }
        }
    }

    // Final sanity check: issue date cannot be after expiry date
    if (issueDate && expiryDate && issueDate > expiryDate) {
        return { issueDate: '', expiryDate: '' };
    }

    return {
        issueDate: issueDate || '',
        expiryDate: expiryDate || ''
    };
}
