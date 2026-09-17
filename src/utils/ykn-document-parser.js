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

const OCR_DATE_CHAR = '[0-9OoОоIiİıLl|ZzSsBbGg]';

const COUNTRY_CODE_ALIASES = Object.freeze({
    AFG: ['AFGANISTAN', 'AFGHANISTAN', 'AFGHANISTAN'],
    ALB: ['ARNAVUTLUK', 'ALBANIA', 'ALBANIE'],
    DZA: ['CEZAYIR', 'ALGERIA', 'ALGERIE'],
    ARG: ['ARJANTIN', 'ARGENTINA'],
    ARM: ['ERMENISTAN', 'ARMENIA'],
    AUS: ['AVUSTRALYA', 'AUSTRALIA'],
    AUT: ['AVUSTURYA', 'AUSTRIA'],
    AZE: ['AZERBAYCAN', 'AZERBAIJAN'],
    BGD: ['BANGLADES', 'BANGLADESH'],
    BEL: ['BELCIKA', 'BELGIUM', 'BELGIQUE'],
    BGR: ['BULGARISTAN', 'BULGARIA'],
    BRA: ['BREZILYA', 'BRAZIL'],
    CAN: ['KANADA', 'CANADA'],
    CHE: ['ISVICRE', 'SWITZERLAND', 'SUISSE'],
    CHN: ['CIN', 'CHINA'],
    COL: ['KOLOMBIYA', 'COLOMBIA'],
    CZE: ['CEKYA', 'CZECHIA', 'CZECH REPUBLIC'],
    DEU: ['ALMANYA', 'GERMANY', 'DEUTSCHLAND'],
    DNK: ['DANIMARKA', 'DENMARK'],
    ECU: ['EKVADOR', 'ECUADOR'],
    EGY: ['MISIR', 'EGYPT'],
    ESP: ['ISPANYA', 'SPAIN', 'ESPANA'],
    ETH: ['ETIYOPYA', 'ETHIOPIA'],
    FRA: ['FRANSA', 'FRANCE'],
    GEO: ['GURCISTAN', 'GEORGIA'],
    GBR: ['BIRLESIK KRALLIK', 'UNITED KINGDOM', 'INGILTERE'],
    GHA: ['GANA', 'GHANA'],
    GRC: ['YUNANISTAN', 'GREECE'],
    IDN: ['ENDONEZYA', 'INDONESIA'],
    IND: ['HINDISTAN', 'INDIA'],
    IRN: ['IRAN'],
    IRQ: ['IRAK', 'IRAQ'],
    ITA: ['ITALYA', 'ITALY'],
    JOR: ['URDUN', 'JORDAN'],
    JPN: ['JAPONYA', 'JAPAN'],
    KAZ: ['KAZAKISTAN', 'KAZAKHSTAN'],
    KEN: ['KENYA'],
    KGZ: ['KIRGIZISTAN', 'KYRGYZSTAN'],
    KOR: ['GUNEY KORE', 'SOUTH KOREA', 'KOREA'],
    LBN: ['LUBNAN', 'LEBANON'],
    LBY: ['LIBYA'],
    MAR: ['FAS', 'MOROCCO'],
    MEX: ['MEKSIKA', 'MEXICO'],
    MNG: ['MOGOLISTAN', 'MONGOLIA'],
    MYS: ['MALEZYA', 'MALAYSIA'],
    NLD: ['HOLLANDA', 'NETHERLANDS'],
    NGA: ['NİJERYA', 'Nijerya', 'NIGERIA'],
    NPL: ['NEPAL'],
    PAK: ['PAKISTAN'],
    PER: ['PERU'],
    PHL: ['FILIPINLER', 'PHILIPPINES'],
    PLE: ['FILISTIN', 'PALESTINE'],
    POL: ['POLONYA', 'POLAND'],
    PRT: ['PORTEKIZ', 'PORTUGAL'],
    QAT: ['KATAR', 'QATAR'],
    ROU: ['ROMANYA', 'ROMANIA'],
    RUS: ['RUSYA', 'RUSSIA'],
    SAU: ['SUUDI ARABISTAN', 'SAUDI ARABIA'],
    SDN: ['SUDAN'],
    SEN: ['SENEGAL'],
    SOM: ['SOMALI', 'SOMALIA'],
    SRB: ['SIRBISTAN', 'SERBIA'],
    SYR: ['SURIYE', 'SYRIA'],
    SWE: ['ISVEC', 'SWEDEN'],
    TJK: ['TACIKISTAN', 'TAJIKISTAN'],
    TKM: ['TURKMENISTAN', 'TURKMEN'],
    TUN: ['TUNUS', 'TUNISIA'],
    TUR: ['TURKIYE', 'TURKEY'],
    UKR: ['UKRAYNA', 'UKRAINE'],
    UZB: ['OZBEKISTAN', 'UZBEKISTAN'],
    USA: ['AMERIKA BIRLESIK DEVLETLERI', 'UNITED STATES', 'USA'],
    UGA: ['UGANDA'],
    ARE: ['BIRLESIK ARAP EMIRLIKLERI', 'UNITED ARAB EMIRATES'],
    VEN: ['VENEZUELA'],
    VNM: ['VIETNAM', 'VIET NAM'],
    YEM: ['YEMEN']
});

function normalizeCountryValue(value) {
    return String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9\u0400-\u04FF]+/g, ' ')
        .trim();
}

export function getCountryIso3Code(value) {
    const normalized = normalizeCountryValue(value);
    if (/^[A-Z]{3}$/.test(normalized)) return normalized;
    for (const [code, aliases] of Object.entries(COUNTRY_CODE_ALIASES)) {
        if (aliases.some((alias) => normalized.includes(normalizeCountryValue(alias)))) return code;
    }
    return '';
}

function extractDateCandidatesFromText(text) {
    const source = normalizeDateText(text);
    const candidates = Array.from(source.matchAll(new RegExp(DATE_PATTERN, 'ig')))
        .map((match) => match[0]);

    // OCR bazen nokta/slash/tire çevresindeki her rakamı ayrı kelime yapar:
    // "1 4 . 0 6 . 2 0 2 4". Ayırıcıları koruyarak bu biçimi birleştir.
    const spacedDatePattern = new RegExp(
        `\\b(${OCR_DATE_CHAR}(?:\\s*${OCR_DATE_CHAR}){0,1})\\s*[./\\-]\\s*` +
        `(${OCR_DATE_CHAR}(?:\\s*${OCR_DATE_CHAR}){0,1})\\s*[./\\-]\\s*` +
        `(${OCR_DATE_CHAR}(?:\\s*${OCR_DATE_CHAR}){1,3})\\b`,
        'ig'
    );
    for (const match of source.matchAll(spacedDatePattern)) {
        candidates.push([match[1], match[2], match[3]].map((part) => part.replace(/\\s+/g, '')).join('.'));
    }

    // Ayırıcılar da kaybolduğunda YYYYMMDD/DDMMYYYY biçiminin boşluklu hali.
    const spacedCompactPattern = new RegExp(
        `\\b((?:${OCR_DATE_CHAR}\\s*){8})\\b`,
        'ig'
    );
    for (const match of source.matchAll(spacedCompactPattern)) {
        candidates.push(match[1].replace(/\\s+/g, ''));
    }

    return candidates;
}

const ISSUE_DATE_LABELS = [
    // English
    'date of issue', 'date of lssue', 'date 0f issue', 'date of issuance', 'issue date', 'date issued', 'dateofissue', 'passport issue date', 'issued on', 'date of delivery', 'issuing date', 'given on',
    // Turkish
    'belge düzenleme tarihi', 'düzenleme tarihi', 'belge düzenlenme tarihi', 'düzenlenme tarihi', 'belgenin düzenlenme tarihi', 'belgenin düzenleme tarihi', 'pasaport düzenleme tarihi', 'pasaport düzenlenme tarihi', 'pasaport veriliş tarihi', 'belge veriliş tarihi', 'veriliş tarihi', 'tanzim tarihi', 'verildiği tarih',
    // Uzbek
    'berilgan sanasi', 'berilgan sana', 'berilgan joyi', 'berilgan vaqti', 'berilgan',
    // Russian (Cyrillic / transliterated)
    'дата выдачи', 'дата выдачи паспорта', 'дата оформления', 'дата выпуска', 'выдан', 'выдано', 'data vydachi',
    // Kazakh, Turkmen, Azerbaijani
    'берілген күні', 'berilgen kuni', 'berlen senesi', 'berlen wagty', 'verilme tarixi', 'verilmə tarixi',
    // French
    'date de delivrance', 'date de délivrance', 'date d emission', "date d'emission", "date d'émission", 'delivre le', 'délivré le', 'delivree le', 'emise le',
    // Spanish
    'fecha de expedicion', 'fecha de expedición', 'fecha de emision', 'fecha de emisión', 'expedido el',
    // German
    'ausstellungsdatum', 'ausgestellt am',
    // Arabic transliterated / keywords
    'tarikh al isdar', 'tarikh al-isdar', 'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ التحرير', 'صدر بتاريخ',
    // Ethiopian (Amharic)
    'የተሰጠበት ቀን', 'የተሰጠበት'
];

const EXPIRY_DATE_LABELS = [
    // English
    'date of expiry', 'date of exp1ry', 'date of expirv', 'date of expir y', 'expiry date', 'date of expiration', 'expiration date', 'passport expiry date', 'date valid until', 'valid until', 'valid untill', 'valid unt1l', 'expires on', 'valid to', 'valid thru', 'valid through', 'date of expiry / date',
    // Turkish
    'belge geçerlilik tarihi', 'geçerlilik tarihi', 'pasaport geçerlilik tarihi', 'belgenin geçerlilik tarihi', 'son kullanma tarihi', 'son geçerlilik tarihi', 'bitiş tarihi', 'gecerlilik suresi',
    // Uzbek
    'amal qilish muddati', 'amal qilish muddat', 'amal qilish', 'amal qilishi', 'muddati',
    // Russian (Cyrillic / transliterated)
    'дата окончания', 'дата окончания срока', 'срок действия паспорта', 'срок действия', 'действителен до', 'действительно до', 'термін дії', 'deystvitelen do', 'srok deystviya',
    // Kazakh, Turkmen, Azerbaijani
    'қолданылу мерзімі', 'қолданылу мерзими', 'qoldanylu merzimi', 'hereket edis mohleti', 'hereket ediş möhleti', 'etibarliliq muddeti', 'etibarlılıq müddəti', 'bitme tarixi', 'bitmə tarixi',
    // French
    'date d expiration', "date d'expiration", 'expire le', 'date de validite', 'date de validité', 'valable jusqu au', 'valable jusqu\'au',
    // Spanish
    'fecha de caducidad', 'fecha de expiracion', 'fecha de expiración', 'fecha de vencimiento', 'valido hasta', 'válido hasta',
    // German
    'gueltig bis', 'gültig bis', 'ablaufdatum',
    // Arabic transliterated / keywords
    'tarikh al intiha', 'tarikh al-intiha', 'تاريخ الانتهاء', 'تاريخ الصلاحية', 'تاريخ النفاذ', 'صالح حتى', 'صالحة لغاية', 'صالح لغاية',
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

// Görsel pasaport OCR'ında sık görülen rakam/harf karışıklıklarını yalnızca
// sayısal tarih adaylarında uygula. Böylece "MAR" gibi ay adları bozulmaz.
function normalizeOcrNumericText(text) {
    return String(text || '')
        .replace(/[oо]/gi, '0')
        .replace(/[iıl|]/gi, '1')
        .replace(/[z]/gi, '2')
        .replace(/[s]/gi, '5')
        .replace(/[b]/gi, '8')
        .replace(/[g]/gi, '6');
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

    // 4. Three numeric parts separated by ., /, -, or space. OCR'da O/0,
    // I/1, Z/2, S/5 ve B/8 karışıklıkları burada düzeltilir.
    const numericNormalized = normalizeOcrNumericText(normalized);
    const parts = numericNormalized.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
        const [first, second, third] = parts;
        const isYearFirst = first.length === 4 || Number(first) > 31;
        const year = normalizeYear(isYearFirst ? first : third);
        const month = Number(second);
        const day = Number(isYearFirst ? third : first);
        return createDateValue(year, month, day);
    }

    // 5. Compact 8-digit (YYYYMMDD or DDMMYYYY)
    const compact = numericNormalized.replace(/[^0-9]/g, '');
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
    const ocrNormalizedText = normalizeOcrNumericText(normalizedText);

    for (const label of labels) {
        const labelPattern = normalizeDateText(label)
            .split(/\s+/)
            .map((part) => part.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&'))
            .join('\\s*[:#\\-\\.\\s/]*');
        const labelMatch = normalizedText.match(new RegExp(labelPattern, 'i'));
        if (!labelMatch) continue;

        // 1. Search forward (after label)
        const start = (labelMatch.index || 0) + labelMatch[0].length;
        for (const sourceText of [normalizedText, ocrNormalizedText]) {
            const dateWindowAfter = sourceText.slice(start, start + 350);
            const dateMatchesAfter = extractDateCandidatesFromText(dateWindowAfter);
            for (const candidate of dateMatchesAfter) {
                const parsed = parseDateValue(candidate);
                if (parsed) {
                    if (birthDate && parsed === birthDate) continue;
                    if (parsed < `${minYear}-01-01` || parsed > `${maxYear}-12-31`) continue;
                    return parsed;
                }
            }
        }

        // 2. Search backward (before label, for table cells / RTL layouts)
        const preStart = Math.max(0, (labelMatch.index || 0) - 150);
        for (const sourceText of [normalizedText, ocrNormalizedText]) {
            const dateWindowBefore = sourceText.slice(preStart, labelMatch.index || 0);
            const dateMatchesBefore = extractDateCandidatesFromText(dateWindowBefore);
            for (let i = dateMatchesBefore.length - 1; i >= 0; i--) {
                const parsed = parseDateValue(dateMatchesBefore[i]);
                if (parsed) {
                    if (birthDate && parsed === birthDate) continue;
                    if (parsed < `${minYear}-01-01` || parsed > `${maxYear}-12-31`) continue;
                    return parsed;
                }
            }
        }
    }
    return '';
}

function sanitizeMrzDigits(raw) {
    if (!raw) return '';
    return raw
        .replace(/O/g, '0')
        .replace(/[ILl]/g, '1')
        .replace(/Z/g, '2')
        .replace(/S/g, '5')
        .replace(/B/g, '8');
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
            const targeted = new RegExp(`${birthYymmdd}[0-9A-Z<]{2}([0-9OIZSB]{6})`, 'i');
            const targetMatch = cleanedText.match(targeted);
            if (targetMatch) {
                const cleanTarget = sanitizeMrzDigits(targetMatch[1]);
                const ey = Number(cleanTarget.slice(0, 2));
                const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
                const expiryDate = createDateValue(expYear, Number(cleanTarget.slice(2, 4)), Number(cleanTarget.slice(4, 6)));
                if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
                    return { issueDate: '', expiryDate, birthDate: options.birthDate };
                }
            }
        }
    }

    // 2. Standard TD3 Line 2 search:
    // [DocNumber: 9 chars][CheckDigit: 1][Nationality: 3 chars](\d{6})[CheckDigit: 1][Sex: 1](\d{6})
    const td3Pattern = /(?:[A-Z0-9<]{9})[0-9A-Z<][A-Z<]{3}([0-9OIZSB]{6})[0-9A-Z<][MF<X0-9]([0-9OIZSB]{6})/i;
    const td3Match = cleanedText.match(td3Pattern);
    if (td3Match) {
        const birthRaw = sanitizeMrzDigits(td3Match[1]);
        const expRaw = sanitizeMrzDigits(td3Match[2]);

        const by = Number(birthRaw.slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

        const ey = Number(expRaw.slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

        if (birthDate && expiryDate) {
            return { issueDate: '', expiryDate, birthDate };
        }
        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
            return { issueDate: '', expiryDate, birthDate: birthDate || '' };
        }
    }

    // 3. General MRZ sequence of two valid YYMMDD dates separated by 2 chars
    const genPattern = /([0-9OIZSB]{6})[0-9A-Z<][MF<X0-9]([0-9OIZSB]{6})/gi;
    const genMatches = Array.from(cleanedText.matchAll(genPattern));
    for (const match of genMatches) {
        const birthRaw = sanitizeMrzDigits(match[1]);
        const expRaw = sanitizeMrzDigits(match[2]);

        const by = Number(birthRaw.slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

        const ey = Number(expRaw.slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

        if (birthDate && expiryDate) {
            return { issueDate: '', expiryDate, birthDate };
        }
        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
            return { issueDate: '', expiryDate, birthDate: birthDate || '' };
        }
    }

    return { issueDate: '', expiryDate: '', birthDate: '' };
}

function extractAllCandidateDates(text) {
    const normalizedText = normalizeDateText(text);
    const sources = [normalizedText, normalizeOcrNumericText(normalizedText)];
    const dates = [];
    const seen = new Set();

    for (const sourceText of sources) {
        const matches = extractDateCandidatesFromText(sourceText);
        for (const candidate of matches) {
            const parsed = parseDateValue(candidate);
            if (parsed && !seen.has(parsed)) {
                seen.add(parsed);
                dates.push(parsed);
            }
        }
    }
    return dates.sort();
}

export function isValidYoksisId(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase()
        .replace(/[–—−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '-');
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
        const id = labeledMatch[1].replace(/\s*[-–—−]\s*/g, '-').replace(/\s+/g, '-').toUpperCase();
        if (isValidYoksisId(id)) {
            return id;
        }
    }

    const nearYoksisMatch = normalizedText.match(
        /(?:YÖKS[İI]S|YOKSIS)[^A-Z0-9]{1,30}?([A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4})/i
    );
    if (nearYoksisMatch) {
        const id = nearYoksisMatch[1].replace(/\s*[-–—−]\s*/g, '-').replace(/\s+/g, '-').toUpperCase();
        if (isValidYoksisId(id)) {
            return id;
        }
    }

    // PDF/OCR bazen tireleri tamamen kaybeder: "821 EC2 34".
    const candidates = normalizedText.match(/\b[A-Z0-9]{2,4}(?:(?:\s*[-–—−]\s*|\s+)[A-Z0-9]{2,4}){2}\b/gi) || [];
    for (const candidate of candidates) {
        const cleaned = candidate.replace(/\s*[-–—−]\s*/g, '-').replace(/\s+/g, '-').toUpperCase();
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

const POB_LABELS = [
    // English
    'place of birth', 'birth place', 'place of origin', 'pob', 'city of birth', 'town of birth', 'country / place of birth',
    // French
    'lieu de naissance', 'lieu d\'origine', 'lieu d origine', 'lieu naissance',
    // Turkish / Azeri
    'doğum yeri', 'dogum yeri', 'doğduğu yer', 'dogdugu yer', 'doğulduğu yer', 'doguldugu yer',
    // Arabic / Persian / Urdu
    'مكان الميلاد', 'محل الميلاد', 'مكان الولادة', 'محل الولادة', 'مكان الازدياد', 'مكان الإزدياد',
    'محل الازدياد', 'مكان وتاريخ الميلاد', 'مكان وتاريخ الولادة', 'تاريخ ومكان الميلاد', 'تاريخ ومكان الولادة',
    'محل وتاريخ الولادة', 'محل وتاريخ الميلاد', 'محل تولد', 'محل ولادت', 'مقام پیدائش',
    // Russian / Cyrillic
    'место рождения', 'место рожд', 'туған жері', 'туған жер', 'туган жери', 'туулган жери',
    'ҷои таваллуд', 'чои таваллуд', 'ҷойи таваллуд', 'туғилган жойи', 'доглан йери', 'доглан ери',
    'місце народження', 'места нараджэння', 'место на раждане', 'место на раждање',
    // Uzbek / Turkmen Latin
    'tug\'ilgan joyi', 'tugilgan joyi', 'tug\'ilgan joy', 'doglan ýeri', 'doglan yeri',
    // Other European / African
    'geburtsort', 'lugar de nacimiento', 'local de nascimento', 'luogo di nascita', 'goobta dhallashada', 'goobta dhalashada'
];

const POB_STOP_WORDS = [
    // English
    'date of birth', 'date of issue', 'date of expiry', 'date', 'issue', 'issuing', 'expiry', 'expiration', 'valid until', 'valid', 'sex', 'gender', 'authority', 'issued by', 'signature', 'nationality', 'national',
    // French
    'date de naissance', 'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date d expiration', 'date', 'sexe', 'autorité', 'autorite', 'delivre par', 'signature', 'nationalité', 'nationalite',
    // Turkish
    'doğum tarihi', 'dogum tarihi', 'veriliş tarihi', 'verilis tarihi', 'tanzim tarihi', 'geçerlilik tarihi', 'gecerlilik tarihi', 'son geçerlilik', 'tarih', 'tarihi', 'cinsiyet', 'veren makam', 'makam', 'imza', 'uyruk', 'uyruğu',
    // Russian
    'дата рождения', 'дата выдачи', 'срок действия', 'действителен до', 'дата', 'пол', 'орган выдачи', 'кем выдан', 'подпись', 'гражданство', 'национальность',
    // Arabic
    'تاريخ الميلاد', 'تاريخ الاصدار', 'تاريخ الإصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ النفاذ', 'تاريخ', 'الجنس', 'النوع', 'المهنة', 'السلطة', 'الجهة', 'الرقم الوطني', 'الرقم القومي', 'الجنسية', 'التوقيع', 'حامل',
    // Other Turkic/Cyrillic
    'amal', 'sana', 'sanasi', 'beril', 'berilgan', 'qoldanylu', 'mohleti', 'möhleti', 'etibarliliq', 'jynsy', 'jinsi'
];

const AUTHORITY_LABELS = [
    // English
    'issuing authority', 'issuing office', 'office of issue', 'place of issue', 'issued by', 'authority', 'passport office',
    // French
    'autorité de délivrance', 'autorite de delivrance', 'autorité', 'autorite', 'délivré par', 'delivre par', 'lieu de délivrance', 'lieu de delivrance',
    // Turkish
    'belgeyi veren makam', 'pasaportu veren makam', 'tanzim eden makam', 'düzenleyen makam', 'duzenleyen makam', 'veren makam', 'verildiği yer', 'verildigi yer',
    // Arabic
    'جهة الإصدار', 'جهة الاصدار', 'الجهة المصدرة', 'مكان الإصدار', 'مكان الاصدار', 'مكان الصدور', 'مكان التحرير',
    'سلطة الإصدار', 'سلطة الاصدار', 'السلطة', 'مركز الإصدار', 'مركز الاصدار', 'صدر عن', 'صدرت من',
    // Russian / Cyrillic
    'орган, выдавший документ', 'орган выдавший документ', 'орган выдачи', 'кем выдан', 'орган що видав',
    'берген орган', 'берген мекеме', 'орган, ки васиқа додааст',
    // Uzbek / Turkmen
    'kim tomonidan berilgan', 'bergan organ', 'berlen ýeri', 'berlen yeri', 'berlən yeri'
];

const AUTHORITY_STOP_WORDS = [
    'date of issue', 'date of expiry', 'date of birth', 'date', 'issue', 'expiry', 'valid',
    'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date de naissance',
    'tarih', 'tarihi', 'veriliş tarihi', 'verilis tarihi', 'geçerlilik tarihi', 'gecerlilik tarihi', 'doğum tarihi', 'dogum tarihi',
    'дата выдачи', 'срок действия', 'дата рождения', 'подпись', 'signature', 'imza',
    'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ الميلاد', 'التوقيع',
    'holder', 'bearer', 'sex', 'cinsiyet', 'пол', 'الجنس', 'photo', 'mrz'
];

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanPlaceOfBirthValue(rawValue) {
    if (!rawValue) return '';
    let val = String(rawValue).trim();

    // 1. Strip date if combined label (e.g. KHARTOUM 12/05/2001)
    val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();
    val = val.replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/gi, '').trim();

    // 2. Strip Russian/Cyrillic city prefixes:
    val = val.replace(/^(?:Г\.|ГОР\.|Г\b|ГОР\b|С\.|С\b|П\.|ПОС\.|ПОС\b|ОБЛ\.|ОБЛ\b|Р-Н\b|Р-Н\.)\s*/i, '');

    // 3. If dual scripts separated by / or \ or |:
    const parts = val.split(/\s*[/\\|]\s*/);
    if (parts.length >= 2) {
        // Prefer Latin script for Turkish YÖKSİS compatibility
        const latinPart = parts.find(p => /[A-Za-z]/.test(p) && !/^(?:Г\.|ГОР\.|CITY|VILLE|P\b)/i.test(p.trim()));
        if (latinPart) {
            val = latinPart;
        } else {
            val = parts[0];
        }
    }

    val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
    val = val.replace(/\s+/g, ' ');
    val = val.replace(/^(?:Г\.|ГОР\.|Г\b|ГОР\b)\s*/i, '');

    if (!val || val.length < 2 || /^\d+$/.test(val)) return '';
    return val;
}

function cleanIssuingAuthorityValue(rawValue) {
    if (!rawValue) return '';
    let val = String(rawValue).trim();

    val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();

    const parts = val.split(/\s*[/\\|]\s*/);
    if (parts.length >= 2) {
        const latinPart = parts.find(p => /[A-Za-z]/.test(p) && !/^(?:AUTHORITY|AUTORITE)\b/i.test(p.trim()));
        if (latinPart) {
            val = latinPart;
        } else {
            val = parts[parts.length - 1];
        }
    }

    val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
    val = val.replace(/\s+/g, ' ');

    if (!val || val.length < 2 || /^\d{1,2}[./\-]/.test(val)) return '';
    return val;
}

function isLabelOnlyLine(line, labels) {
    let rem = line.trim();
    if (!rem) return false;
    let matchedAny = false;
    let keepLooping = true;
    while (keepLooping) {
        keepLooping = false;
        rem = rem.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
        for (const l of labels) {
            const regex = new RegExp('^' + escapeRegex(l), 'i');
            if (regex.test(rem)) {
                rem = rem.replace(regex, '').trim();
                matchedAny = true;
                keepLooping = true;
                break;
            }
        }
    }
    rem = rem.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
    return matchedAny && rem.length === 0;
}

export function extractPassportPlaceOfBirth(text, options = {}) {
    if (!text || typeof text !== 'string') return '';
    const normalized = text.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ');
    const upperText = normalized.toUpperCase();

    // Türkmenistan kontrolü: Türkmen pasaportlarında doğum yeri açıklaması YÖKSİS için TKM sabittir
    const nationalityCheck = String(options.nationality || options.country || options.uyruk || options.dogumUlkesi || '').toUpperCase();
    const isTurkmen = nationalityCheck.includes('TÜRKMEN') ||
        nationalityCheck.includes('TURKMEN') ||
        nationalityCheck === 'TKM' ||
        upperText.includes('P<TKM') ||
        (upperText.includes('TURKMENISTAN') && !upperText.includes('EMBASSY OF TURKMENISTAN'));

    if (isTurkmen) {
        return 'TKM';
    }

    const lines = normalized.split(/[\r\n]+/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const foundLabel = POB_LABELS.find(l => {
            const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
            return regex.test(line);
        });

        if (!foundLabel) continue;

        const labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
        let remainder = line.slice(labelIndex);

        let keepStripping = true;
        while (keepStripping) {
            keepStripping = false;
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
            for (const l of POB_LABELS) {
                const r = new RegExp('^' + escapeRegex(l), 'i');
                if (r.test(remainder)) {
                    remainder = remainder.replace(r, '').trim();
                    keepStripping = true;
                    break;
                }
            }
        }

        remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

        if (remainder.length >= 2) {
            for (const stop of POB_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = remainder.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                    remainder = remainder.slice(0, stopMatch.index).trim();
                }
            }
            const cleaned = cleanPlaceOfBirthValue(remainder);
            if (cleaned) return cleaned.toUpperCase();
        }

        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            if (!nextLine) continue;

            if (isLabelOnlyLine(nextLine, POB_LABELS)) continue;
            if (isLabelOnlyLine(nextLine, POB_STOP_WORDS)) break;

            let val = nextLine;
            for (const stop of POB_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = val.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                    val = val.slice(0, stopMatch.index).trim();
                }
            }
            const cleaned = cleanPlaceOfBirthValue(val);
            if (cleaned) return cleaned.toUpperCase();
        }
    }

    return '';
}

export function extractPassportIssuingAuthority(text, options = {}) {
    if (!text || typeof text !== 'string') {
        return getCountryIso3Code(
            options.uyruk || options.nationality || options.country || options.dogumUlkesi
        );
    }
    const normalized = text.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ');
    const lines = normalized.split(/[\r\n]+/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const foundLabel = AUTHORITY_LABELS.find(l => {
            const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
            return regex.test(line);
        });

        if (!foundLabel) continue;

        const labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
        let remainder = line.slice(labelIndex);

        let keepStripping = true;
        while (keepStripping) {
            keepStripping = false;
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
            for (const l of AUTHORITY_LABELS) {
                const r = new RegExp('^' + escapeRegex(l), 'i');
                if (r.test(remainder)) {
                    remainder = remainder.replace(r, '').trim();
                    keepStripping = true;
                    break;
                }
            }
        }

        remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

        if (remainder.length >= 2) {
            for (const stop of AUTHORITY_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = remainder.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                    remainder = remainder.slice(0, stopMatch.index).trim();
                }
            }
            const cleaned = cleanIssuingAuthorityValue(remainder);
            if (cleaned) return cleaned.toUpperCase();
        }

        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            if (!nextLine) continue;

            if (isLabelOnlyLine(nextLine, AUTHORITY_LABELS)) continue;
            if (isLabelOnlyLine(nextLine, AUTHORITY_STOP_WORDS)) break;

            let val = nextLine;
            for (const stop of AUTHORITY_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = val.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                    val = val.slice(0, stopMatch.index).trim();
                }
            }
            const cleaned = cleanIssuingAuthorityValue(val);
            if (cleaned) return cleaned.toUpperCase();
        }
    }

    const mrzMatch = normalized.toUpperCase().match(/P\s*<\s*([A-Z]{3})/);
    if (mrzMatch) return mrzMatch[1];

    return getCountryIso3Code(
        options.uyruk || options.nationality || options.country || options.dogumUlkesi
    );
}

export function extractPassportMetadata(text, options = {}) {
    const dates = extractPassportDatesFromText(text, options);
    const placeOfBirth = extractPassportPlaceOfBirth(text, options);
    const issuingAuthority = extractPassportIssuingAuthority(text, options);

    return {
        issueDate: dates.issueDate || '',
        expiryDate: dates.expiryDate || '',
        placeOfBirth: placeOfBirth || '',
        issuingAuthority: issuingAuthority || ''
    };
}
