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

const DATE_PATTERN = `(?:(?:19\\d{2}|20\\d{2})\\s*[./\\-]\\s*\\d{1,2}\\s*[./\\-]\\s*\\d{1,2}|\\d{1,2}\\s*[./\\-]\\s*\\d{1,2}\\s*[./\\-]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}\\s*[./\\-\\s]\\s*(?:${MONTH_PATTERN})\\.?\\s*[./\\-\\s]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|(?:${MONTH_PATTERN})\\.?\\s*[./\\-\\s]\\s*\\d{1,2}\\s*,?\\s*[./\\-\\s]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}(?:${MONTH_PATTERN})(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}\\s+\\d{1,2}\\s+(?:19\\d{2}|20\\d{2}|\\d{2})|\\b(?:19\\d{2}|20\\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b|\\b(?:0[1-9]|[12]\\d|3[01])(?:0[1-9]|1[0-2])(?:19\\d{2}|20\\d{2})\\b)`;

const ISSUE_DATE_LABELS = [
    // English
    'date of issue', 'date of issuance', 'issue date', 'date issued', 'dateofissue', 'passport issue date', 'issued on', 'date of delivery', 'issuing date', 'given on',
    // Turkish
    'belge düzenleme tarihi', 'düzenleme tarihi', 'belge düzenlenme tarihi', 'düzenlenme tarihi', 'belgenin düzenlenme tarihi', 'belgenin düzenleme tarihi', 'pasaport düzenleme tarihi', 'pasaport düzenlenme tarihi', 'pasaport veriliş tarihi', 'belge veriliş tarihi', 'veriliş tarihi', 'tanzim tarihi', 'verildiği tarih',
    // Uzbek
    'berilgan sanasi', 'berilgan sana', 'berilgan joyi', 'berilgan vaqti', 'berilgan',
    // Russian (Cyrillic / transliterated)
    'дата выдачи', 'выдан', 'выдано', 'дата оформления', 'data vydachi',
    // Kazakh, Turkmen, Azerbaijani
    'берілген күні', 'berilgen kuni', 'berlen senesi', 'berlen wagty', 'verilme tarixi', 'verilmə tarixi',
    // French
    'date de delivrance', 'date de délivrance', 'date d emission', "date d'emission", "date d'émission", 'delivre le', 'délivré le', 'delivree le', 'emise le',
    // Spanish
    'fecha de expedicion', 'fecha de expedición', 'fecha de emision', 'fecha de emisión', 'expedido el',
    // German
    'ausstellungsdatum', 'ausgestellt am',
    // Arabic transliterated / keywords
    'tarikh al isdar', 'tarikh al-isdar', 'تاريخ الإصدار', 'تاريخ الاصدار',
    // Ethiopian (Amharic)
    'የተሰጠበት ቀን', 'የተሰጠበት'
];

const EXPIRY_DATE_LABELS = [
    // English
    'date of expiry', 'expiry date', 'date of expiration', 'expiration date', 'passport expiry date', 'date valid until', 'valid until', 'expires on', 'valid to', 'valid thru', 'valid through', 'date of expiry / date',
    // Turkish
    'belge geçerlilik tarihi', 'geçerlilik tarihi', 'pasaport geçerlilik tarihi', 'belgenin geçerlilik tarihi', 'son kullanma tarihi', 'son geçerlilik tarihi', 'bitiş tarihi', 'gecerlilik suresi',
    // Uzbek
    'amal qilish muddati', 'amal qilish muddat', 'amal qilish', 'amal qilishi', 'muddati',
    // Russian (Cyrillic / transliterated)
    'дата окончания', 'дата окончания срока', 'срок действия паспорта', 'срок действия', 'действителен до', 'действительно до', 'deystvitelen do', 'srok deystviya',
    // Kazakh, Turkmen, Azerbaijani
    'қолданылу мерзімі', 'қолданылу мерзими', 'qoldanylu merzimi', 'hereket edis mohleti', 'hereket ediş möhleti', 'etibarliliq muddeti', 'etibarlılıq müddəti', 'bitme tarixi', 'bitmə tarixi',
    // French
    'date d expiration', "date d'expiration", 'expire le', 'date de validite', 'date de validité', 'valable jusqu au', 'valable jusqu\'au',
    // Spanish
    'fecha de caducidad', 'fecha de expiracion', 'fecha de expiración', 'fecha de vencimiento', 'valido hasta', 'válido hasta',
    // German
    'gueltig bis', 'gültig bis', 'ablaufdatum',
    // Arabic transliterated / keywords
    'tarikh al intiha', 'tarikh al-intiha', 'تاريخ الانتهاء', 'تاريخ الصلاحية', 'صالح حتى',
    // Ethiopian (Amharic)
    'የሚያበቃበት ቀን', 'የሚያበቃበት'
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
    if (year < 1920 || year > 2045) return 0;
    return year;
}

function createDateValue(year, month, day) {
    if (year < 1920 || year > 2045 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return '';
    }
    return date.toISOString().slice(0, 10);
}

export function parseDateValue(value) {
    if (!value) return '';
    const normalized = normalizeDateText(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Month name with space, dash, slash, or dot (e.g. "11 MAR 2025", "11-MAR-2025", "11/MAR/25", "16 / DEC / 2022", "16 DEC. 2022")
    const monthClean = normalized.replace(/[-/.]/g, ' ').replace(/\s+/g, ' ').trim();
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

function findLabeledDate(text, labels, options = {}) {
    const minYear = options.minYear || 1920;
    const maxYear = options.maxYear || 2045;
    const birthDate = options.birthDate || '';
    const normalizedText = normalizeDateText(text);

    for (const label of labels) {
        const labelPattern = normalizeDateText(label)
            .split(/\s+/)
            .map((part) => part.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&'))
            .join('\\s*[:#\\-\\.\\s/]*');
        const labelMatch = normalizedText.match(new RegExp(labelPattern, 'i'));
        if (!labelMatch) continue;

        // 1. Search forward (after label)
        const start = (labelMatch.index || 0) + labelMatch[0].length;
        const dateWindowAfter = normalizedText.slice(start, start + 350);
        const dateMatchesAfter = Array.from(dateWindowAfter.matchAll(new RegExp(DATE_PATTERN, 'ig')));
        for (const match of dateMatchesAfter) {
            const parsed = parseDateValue(match[0]);
            if (parsed) {
                if (birthDate && parsed === birthDate) continue;
                if (parsed < `${minYear}-01-01` || parsed > `${maxYear}-12-31`) continue;
                return parsed;
            }
        }

        // 2. Search backward (before label, for table cells / RTL layouts)
        const preStart = Math.max(0, (labelMatch.index || 0) - 150);
        const dateWindowBefore = normalizedText.slice(preStart, labelMatch.index || 0);
        const dateMatchesBefore = Array.from(dateWindowBefore.matchAll(new RegExp(DATE_PATTERN, 'ig')));
        for (let i = dateMatchesBefore.length - 1; i >= 0; i--) {
            const parsed = parseDateValue(dateMatchesBefore[i][0]);
            if (parsed) {
                if (birthDate && parsed === birthDate) continue;
                if (parsed < `${minYear}-01-01` || parsed > `${maxYear}-12-31`) continue;
                return parsed;
            }
        }
    }
    return '';
}

export function extractDatesFromMrz(text, options = {}) {
    if (!text) return { issueDate: '', expiryDate: '', birthDate: '' };

    // Clean OCR artifacts: normalize brackets, guillemets, and noise to '<', uppercase
    const cleanedText = text
        .replace(/[\r\n\t\s]+/g, '')
        .replace(/[«‹\(\{\[\}\]\)]/g, '<')
        .toUpperCase();

    // 1. If birthDate is known (e.g. '2008-10-16' -> '081016'), use it to pinpoint expiry in MRZ
    if (options.birthDate) {
        const parts = options.birthDate.split('-');
        if (parts.length === 3) {
            const birthYymmdd = parts[0].slice(2) + parts[1].padStart(2, '0') + parts[2].padStart(2, '0');
            // In MRZ TD3: birthYYMMDD + [check_digit] + [sex] + expiryYYMMDD
            const targeted = new RegExp(`${birthYymmdd}[0-9A-Z<]{2}(\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01]))`, 'i');
            const targetMatch = cleanedText.match(targeted);
            if (targetMatch) {
                const ey = Number(targetMatch[1].slice(0, 2));
                const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
                const expiryDate = createDateValue(expYear, Number(targetMatch[1].slice(2, 4)), Number(targetMatch[1].slice(4, 6)));
                if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
                    return { issueDate: '', expiryDate, birthDate: options.birthDate };
                }
            }
        }
    }

    // 2. Standard TD3 Line 2 search:
    // [DocNumber: 9 chars][CheckDigit: 1][Nationality: 3 chars](\d{6})[CheckDigit: 1][Sex: 1](\d{6})
    const td3Pattern = /(?:[A-Z0-9<]{9})[0-9A-Z<][A-Z0-9<]{3}(\d{6})[0-9A-Z<][A-Z0-9<](\d{6})/i;
    const td3Match = cleanedText.match(td3Pattern);
    if (td3Match) {
        const birthRaw = td3Match[1];
        const expRaw = td3Match[2];

        const by = Number(birthRaw.slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

        const ey = Number(expRaw.slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
            return { issueDate: '', expiryDate, birthDate };
        }
    }

    // 3. General MRZ sequence of two valid YYMMDD dates separated by 2 chars
    const genPattern = /(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))[0-9A-Z<]{2}(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))/g;
    const genMatches = Array.from(cleanedText.matchAll(genPattern));
    for (const match of genMatches) {
        const by = Number(match[1].slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(match[1].slice(2, 4)), Number(match[1].slice(4, 6)));

        const ey = Number(match[2].slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(match[2].slice(2, 4)), Number(match[2].slice(4, 6)));

        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
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
    // Attempt MRZ extraction first to get birthDate and expiry hints
    const mrz = extractDatesFromMrz(text, options);
    const birthDate = options.birthDate || mrz.birthDate || '';

    let issueDate = findLabeledDate(normalizedText, ISSUE_DATE_LABELS, {
        minYear: 2010,
        maxYear: 2045,
        birthDate: birthDate
    });
    let expiryDate = findLabeledDate(normalizedText, EXPIRY_DATE_LABELS, {
        minYear: 2020,
        maxYear: 2045,
        birthDate: birthDate
    });

    if (!expiryDate && mrz.expiryDate) {
        expiryDate = mrz.expiryDate;
    }

    // If dates are swapped or identical:
    if (issueDate && expiryDate && issueDate >= expiryDate) {
        if (mrz.expiryDate && mrz.expiryDate > issueDate) {
            expiryDate = mrz.expiryDate;
        } else {
            return { issueDate: '', expiryDate: '' };
        }
    }

    // If still missing, check all candidate dates in document:
    if (!issueDate || !expiryDate) {
        const candidates = extractAllCandidateDates(text);
        const today = new Date().toISOString().slice(0, 10);
        const birthDate = options.birthDate || mrz.birthDate || '';

        // Filter out dates that are birth dates or outside plausible passport ranges (2010-2045)
        const plausibleDates = candidates.filter((d) => {
            if (birthDate && d === birthDate) return false;
            if (d < '2010-01-01' || d > '2045-12-31') return false; // Absolutely rejects 5552 or invalid years
            return true;
        });

        if (!issueDate && !expiryDate && plausibleDates.length >= 2) {
            // If neither date was found by label/MRZ, earliest is issue date and latest is expiry date
            issueDate = plausibleDates[0];
            expiryDate = plausibleDates[plausibleDates.length - 1];
        } else {
            if (!expiryDate) {
                const futureDates = plausibleDates.filter((d) => d >= today && (!issueDate || d > issueDate));
                if (futureDates.length > 0) {
                    expiryDate = futureDates[futureDates.length - 1];
                } else if (plausibleDates.length > 0 && issueDate) {
                    const afterIssue = plausibleDates.filter((d) => d > issueDate);
                    if (afterIssue.length > 0) expiryDate = afterIssue[afterIssue.length - 1];
                }
            }

            if (!issueDate) {
                const pastDates = plausibleDates.filter((d) => d <= today && (!expiryDate || d < expiryDate));
                if (pastDates.length > 0) {
                    issueDate = pastDates[pastDates.length - 1];
                } else if (plausibleDates.length > 0 && expiryDate) {
                    const beforeExpiry = plausibleDates.filter((d) => d < expiryDate);
                    if (beforeExpiry.length > 0) issueDate = beforeExpiry[0];
                }
            }
        }
    }

    // Final sanity check: issue date cannot be after expiry date
    if (issueDate && expiryDate && issueDate > expiryDate) {
        expiryDate = '';
    }

    return {
        issueDate: issueDate || '',
        expiryDate: expiryDate || ''
    };
}
