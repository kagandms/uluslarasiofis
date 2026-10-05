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
    ocak: 1, oca: 1, subat: 2, şubat: 2, sub: 2, şub: 2, mart: 3, mar: 3, nisan: 4, nis: 4,
    mayis: 5, mayıs: 5, may: 5, haziran: 6, haz: 6, temmuz: 7, tem: 7, agustos: 8, ağustos: 8, agu: 8, ağu: 8,
    eylul: 9, eylül: 9, eyl: 9, ekim: 10, eki: 10, kasim: 11, kasım: 11, kas: 11, aralik: 12, aralık: 12, ara: 12,
    // French
    janv: 1, janvier: 1, fevr: 2, fevrier: 2, février: 2, mars: 3, avr: 4, avril: 4,
    mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8, août: 8, sept: 9, septembre: 9,
    octobre: 10, nov: 11, novembre: 11, decembre: 12, décembre: 12,
    // Spanish
    ene: 1, enero: 1, febrero: 2, marzo: 3, abr: 4, abril: 4, mayo: 5,
    junio: 6, julio: 7, ago: 8, agosto: 8, setiembre: 9, septiembre: 9,
    octubre: 10, dic: 12, diciembre: 12,
    // Portuguese
    janeiro: 1, fev: 2, fevereiro: 2, marco: 3, março: 3, maio: 5,
    out: 10, outubro: 10, dez: 12, dezembro: 12,
    // German
    mrz: 3, maerz: 3, märz: 3, mai: 5, juni: 6, juli: 7, okt: 10, oktober: 10, dez: 12, dezember: 12,
    // Italian
    gen: 1, gennaio: 1, mag: 5, maggio: 5, giu: 6, giugno: 6, lug: 7, luglio: 7, ott: 10, ottobre: 10,
    // Roman numerals (Eastern European & CIS passports: e.g. 12.VII.2021)
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6,
    vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
    // Russian / Cyrillic (short, nominative, and genitive)
    янв: 1, январь: 1, января: 1,
    фев: 2, февраль: 2, февраля: 2,
    мар: 3, март: 3, марта: 3,
    апр: 4, апрель: 4, апреля: 4,
    май: 5, маи: 5, мая: 5,
    июн: 6, июнь: 6, июня: 6,
    июл: 7, июль: 7, июля: 7,
    авг: 8, август: 8, августа: 8,
    сен: 9, сентябрь: 9, сентября: 9,
    окт: 10, октябрь: 10, октября: 10,
    ноя: 11, ноябрь: 11, ноября: 11,
    дек: 12, декабрь: 12, декабря: 12,
    // Central Asian / Turkic (Uzbek, Kazakh, Turkmen, Azeri)
    yanvar: 1, fevral: 2, mart: 3, aprel: 4, iyun: 6, iyul: 7, avgust: 8, avqust: 8, sentabr: 9, sentyabr: 9, oktabr: 10, oktyabr: 10, noyabr: 11, dekabr: 12,
    қаң: 1, қаңтар: 1, ақп: 2, ақпан: 2, нау: 3, наурыз: 3, сәу: 4, сәуір: 4, мам: 5, мамыр: 5, мау: 6, маусым: 6, шіл: 7, шілде: 7, там: 8, тамыз: 8, қыр: 9, қыркүйек: 9, қаз: 10, қазан: 10, қар: 11, қараша: 11, жел: 12, желтоқсан: 12,
    ýanwar: 1, yanwar: 1, fewral: 2, maý: 5, iýun: 6, iýul: 7, awgust: 8, sentýabr: 9, oktýabr: 10, noýabr: 11,
    // Arabic (Gregorian & Levant)
    يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5,
    يونيو: 6, يوليو: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9,
    اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
    شباط: 2, آذار: 3, اذار: 3, نيسان: 4, أيار: 5, ايار: 5,
    حزيران: 6, تموز: 7, آب: 8, اب: 8, أيلول: 9, ايلول: 9
};

const MONTH_PATTERN = Object.keys(MONTH_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join('|');

const DATE_PATTERN = `(?:(?:19\\d{2}|20\\d{2})\\s*[./\\-]\\s*\\d{1,2}\\s*[./\\-]\\s*\\d{1,2}|\\d{1,2}\\s*[./\\-]\\s*\\d{1,2}\\s*[./\\-]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}(?:st|nd|rd|th)?\\s*[./\\-\\s]\\s*(?:${MONTH_PATTERN})\\.?\\s*[./\\-\\s]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|(?:${MONTH_PATTERN})\\.?\\s*[./\\-\\s]\\s*\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s*[./\\-\\s]\\s*(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}(?:${MONTH_PATTERN})(?:19\\d{2}|20\\d{2}|\\d{2})|\\d{1,2}\\s+\\d{1,2}\\s+(?:19\\d{2}|20\\d{2}|\\d{2})|\\b(?:19\\d{2}|20\\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b|\\b(?:0[1-9]|[12]\\d|3[01])(?:0[1-9]|1[0-2])(?:19\\d{2}|20\\d{2})\\b)`;

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
        candidates.push([match[1], match[2], match[3]].map((part) => part.replace(/\s+/g, '')).join('.'));
    }

    // Ayırıcılar da kaybolduğunda YYYYMMDD/DDMMYYYY biçiminin boşluklu hali.
    const spacedCompactPattern = new RegExp(
        `\\b((?:${OCR_DATE_CHAR}\\s*){8})\\b`,
        'ig'
    );
    for (const match of source.matchAll(spacedCompactPattern)) {
        candidates.push(match[1].replace(/\s+/g, ''));
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
    'дата выдачи', 'дата выдачи паспорта', 'дата оформления', 'дата выпуска', 'выдан', 'выдано', 'data vydachi', 'дата видачі', 'дата выдачы',
    // Kazakh, Turkmen, Azerbaijani
    'берілген күні', 'berilgen kuni', 'berlen senesi', 'berlen wagty', 'berlen güni', 'berlen guni', 'verilme tarixi', 'verilmə tarixi',
    // French
    'date de delivrance', 'date de délivrance', 'date d emission', "date d'emission", "date d'émission", 'delivre le', 'délivré le', 'delivree le', 'emise le',
    // Spanish / Portuguese
    'fecha de expedicion', 'fecha de expedición', 'fecha de emision', 'fecha de emisión', 'expedido el', 'data de emissao', 'data de emissão', 'emitido em',
    // Italian
    'data di rilascio', 'rilasciato il', 'data rilascio',
    // German
    'ausstellungsdatum', 'ausgestellt am',
    // Arabic transliterated / keywords
    'tarikh al isdar', 'tarikh al-isdar', 'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ التحرير', 'صدر بتاريخ', 'حرر في',
    // Ethiopian (Amharic)
    'የተሰጠበት ቀን', 'የተሰጠበት'
];

const EXPIRY_DATE_LABELS = [
    // English
    'date of expiry', 'date of exp1ry', 'date of expirv', 'date of expir y', 'expiry date', 'date of expiration', 'expiration date', 'passport expiry date', 'date valid until', 'valid until', 'valid untill', 'valid unt1l', 'expires on', 'valid to', 'valid thru', 'valid through', 'date of expiry / date',
    // Turkish
    'belge geçerlilik tarihi', 'geçerlilik tarihi', 'pasaport geçerlilik tarihi', 'belgenin geçerlilik tarihi', 'son kullanma tarihi', 'son geçerlilik tarihi', 'bitiş tarihi', 'gecerlilik suresi', 'geçerlilik süresi',
    // Uzbek
    'amal qilish muddati', 'amal qilish muddat', 'amal qilish', 'amal qilishi', 'muddati',
    // Russian (Cyrillic / transliterated)
    'дата окончания', 'дата окончания срока', 'срок действия паспорта', 'срок действия', 'действителен до', 'действительно до', 'термін дії', 'deystvitelen do', 'srok deystviya', 'дзейсны да', 'дата заканчэння',
    // Kazakh, Turkmen, Azerbaijani, Kyrgyz
    'қолданылу мерзімі', 'қолданылу мерзими', 'qoldanylu merzimi', 'hereket edis mohleti', 'hereket ediş möhleti', 'etibarliliq muddeti', 'etibarlılıq müddəti', 'bitme tarixi', 'bitmə tarixi', 'жарамдуулук мөөнөтү',
    // French
    'date d expiration', "date d'expiration", 'expire le', 'date de validite', 'date de validité', 'valable jusqu au', 'valable jusqu\'au',
    // Spanish / Portuguese
    'fecha de caducidad', 'fecha de expiracion', 'fecha de expiración', 'fecha de vencimiento', 'valido hasta', 'válido hasta', 'data de validade', 'valido ate', 'válido até',
    // Italian
    'data di scadenza', 'scadenza', 'valido fino al',
    // German
    'gueltig bis', 'gültig bis', 'ablaufdatum',
    // Arabic transliterated / keywords
    'tarikh al intiha', 'tarikh al-intiha', 'تاريخ الانتهاء', 'تاريخ الصلاحية', 'تاريخ النفاذ', 'صالح حتى', 'صالحة لغاية', 'صالح لغاية', 'تاريخ انتهاء الصلاحية', 'صالحة إلى', 'صالح الى', 'ينتهي في',
    // Ethiopian (Amharic)
    'የሚያበቃበት ቀን', 'የሚያበቃበት'
];

function convertEasternToAsciiDigits(text) {
    return String(text || '')
        .replace(/[\u0660\u06F0]/g, '0')
        .replace(/[\u0661\u06F1]/g, '1')
        .replace(/[\u0662\u06F2]/g, '2')
        .replace(/[\u0663\u06F3]/g, '3')
        .replace(/[\u0664\u06F4]/g, '4')
        .replace(/[\u0665\u06F5]/g, '5')
        .replace(/[\u0666\u06F6]/g, '6')
        .replace(/[\u0667\u06F7]/g, '7')
        .replace(/[\u0668\u06F8]/g, '8')
        .replace(/[\u0669\u06F9]/g, '9');
}

function normalizeDocumentText(text) {
    return convertEasternToAsciiDigits(text)
        .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDateText(text) {
    return normalizeDocumentText(text)
        .replace(/[–—]/g, '-')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        // Clean bilingual month slashes e.g. "MAR / MARS" -> "MAR", "ДЕК / DEC" -> "ДЕК", "MAY-MAI" -> "MAY"
        .replace(/(?:^|[\s\d])([a-z\u0400-\u04ff]{3,4})\s*[\/\-]\s*[a-z\u0400-\u04ff]{3,6}(?=[\s\d]|$)/giu, ' $1 ')
        // Strip ordinal suffixes from days: "15th" -> "15", "1st" -> "1", "2nd" -> "2", "3rd" -> "3"
        .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1')
        // Strip connector words between day and month (Spanish/Portuguese "de", Italian "di", English "of")
        .replace(/\b(?:de|di|of)\b/gi, ' ')
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
    const monthDate = monthClean.match(/^(\d{1,2})\s+([a-z\u0400-\u04ff\u0600-\u06ff]+)\s+(\d{2,4})$/)
        || monthClean.match(/^([a-z\u0400-\u04ff\u0600-\u06ff]+)\s+(\d{1,2})\s+(\d{2,4})$/);
    if (monthDate) {
        const isDayFirst = /^\d/.test(monthDate[1]);
        const day = Number(isDayFirst ? monthDate[1] : monthDate[2]);
        const month = MONTH_ALIASES[isDayFirst ? monthDate[2] : monthDate[1]];
        const year = normalizeYear(monthDate[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 2. Compact month without spaces (e.g. "11MAR2025" or "11MAR25")
    const compactMonth = normalized.match(/^(\d{1,2})([a-z\u0400-\u04ff\u0600-\u06ff]+)(\d{2,4})$/);
    if (compactMonth) {
        const day = Number(compactMonth[1]);
        const month = MONTH_ALIASES[compactMonth[2]];
        const year = normalizeYear(compactMonth[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 3. Year first with month (e.g. "2025 MAR 11")
    const yearMonthDate = monthClean.match(/^(\d{4})\s+([a-z\u0400-\u04ff\u0600-\u06ff]+)\s+(\d{1,2})$/);
    if (yearMonthDate) {
        const year = normalizeYear(yearMonthDate[1]);
        const month = MONTH_ALIASES[yearMonthDate[2]];
        const day = Number(yearMonthDate[3]);
        if (month) return createDateValue(year, month, day);
    }

    // 4. Three numeric parts separated by ., /, -, or space. OCR'da O/0,
    // I/1, Z/2, S/5 ve B/8 karışıklıkları burada düzeltilir.
    // Desteklenenler: DD.MM.YYYY, YYYY.MM.DD ve gün > 12 olduğunda ABD biçimi MM/DD/YYYY.
    const numericNormalized = normalizeOcrNumericText(normalized);
    const parts = numericNormalized.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
        const [first, second, third] = parts;
        const isYearFirst = first.length === 4 || Number(first) > 31;
        const year = normalizeYear(isYearFirst ? first : third);
        let month = Number(second);
        let day = Number(isYearFirst ? third : first);

        // ABD biçimi MM/DD/YYYY otomatik tespiti (ikinci kısım gün ve > 12 ise)
        if (!isYearFirst) {
            if (month > 12 && Number(first) <= 12) {
                month = Number(first);
                day = Number(second);
            }
        } else {
            // YYYY/DD/MM biçimi tespiti
            if (month > 12 && Number(third) <= 12) {
                month = Number(third);
                day = Number(second);
            }
        }
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
        const labelRegex = new RegExp(labelPattern, 'gi');
        let labelMatch;
        while ((labelMatch = labelRegex.exec(normalizedText)) !== null) {
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
    if (!text) return { issueDate: '', expiryDate: '', birthDate: '', cinsiyet: '', passportNumber: '' };

    // Clean OCR artifacts: normalize brackets, guillemets, and noise to '<', uppercase
    const cleanedText = text
        .replace(/[\r\n\t\s]+/g, '')
        .replace(/[«‹\(\{\[\}\]\)]/g, '<')
        .toUpperCase();

    let cinsiyet = '';
    let passportNumber = '';

    // Extract passport number from line 1 if standard P<XXX pattern is found:
    const pCodeMatch = cleanedText.match(/P[<A-Z0-9]([A-Z]{3})([A-Z0-9<]{9})/);
    if (pCodeMatch) {
        const pNum = pCodeMatch[2].replace(/</g, '').trim();
        if (pNum && pNum.length >= 5) passportNumber = pNum;
    }

    // 1. If birthDate is known (e.g. '2008-10-16' -> '081016'), use it to pinpoint expiry in MRZ
    if (options.birthDate) {
        const parts = options.birthDate.split('-');
        if (parts.length === 3) {
            const birthYymmdd = parts[0].slice(2) + parts[1].padStart(2, '0') + parts[2].padStart(2, '0');
            // In MRZ TD3: birthYYMMDD + [check_digit] + [sex] + expiryYYMMDD
            const targeted = new RegExp(`${birthYymmdd}[0-9A-Z<]{1}([MF<X0-9])([0-9OIZSB]{6})`, 'i');
            const targetMatch = cleanedText.match(targeted);
            if (targetMatch) {
                const sexChar = targetMatch[1].toUpperCase();
                if (sexChar === 'M') cinsiyet = 'Erkek';
                else if (sexChar === 'F') cinsiyet = 'Kadın';

                const cleanTarget = sanitizeMrzDigits(targetMatch[2]);
                const ey = Number(cleanTarget.slice(0, 2));
                const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
                const expiryDate = createDateValue(expYear, Number(cleanTarget.slice(2, 4)), Number(cleanTarget.slice(4, 6)));
                if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
                    return { issueDate: '', expiryDate, birthDate: options.birthDate, cinsiyet, passportNumber };
                }
            }
        }
    }

    // 2. Standard TD3 Line 2 search:
    // [DocNumber: 9 chars][CheckDigit: 1][Nationality: 3 chars](\d{6})[CheckDigit: 1][Sex: 1](\d{6})
    const td3Pattern = /(?:([A-Z0-9<]{9})[0-9A-Z<][A-Z<]{3})?([0-9OIZSB]{6})[0-9A-Z<]([MF<X0-9])([0-9OIZSB]{6})/i;
    const td3Match = cleanedText.match(td3Pattern);
    if (td3Match) {
        if (td3Match[1] && !passportNumber) {
            const pNum = td3Match[1].replace(/</g, '').trim();
            if (pNum && pNum.length >= 5) passportNumber = pNum;
        }

        const sexChar = td3Match[3].toUpperCase();
        if (sexChar === 'M') cinsiyet = 'Erkek';
        else if (sexChar === 'F') cinsiyet = 'Kadın';

        const birthRaw = sanitizeMrzDigits(td3Match[2]);
        const expRaw = sanitizeMrzDigits(td3Match[4]);

        const by = Number(birthRaw.slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

        const ey = Number(expRaw.slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

        if (birthDate && expiryDate) {
            return { issueDate: '', expiryDate, birthDate, cinsiyet, passportNumber };
        }
        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
            return { issueDate: '', expiryDate, birthDate: birthDate || '', cinsiyet, passportNumber };
        }
    }

    // 3. General MRZ sequence of two valid YYMMDD dates separated by 2 chars
    const genPattern = /([0-9OIZSB]{6})[0-9A-Z<]([MF<X0-9])([0-9OIZSB]{6})/gi;
    const genMatches = Array.from(cleanedText.matchAll(genPattern));
    for (const match of genMatches) {
        const sexChar = match[2].toUpperCase();
        if (!cinsiyet) {
            if (sexChar === 'M') cinsiyet = 'Erkek';
            else if (sexChar === 'F') cinsiyet = 'Kadın';
        }

        const birthRaw = sanitizeMrzDigits(match[1]);
        const expRaw = sanitizeMrzDigits(match[3]);

        const by = Number(birthRaw.slice(0, 2));
        const birthYear = by <= 49 ? 2000 + by : 1900 + by;
        const birthDate = createDateValue(birthYear, Number(birthRaw.slice(2, 4)), Number(birthRaw.slice(4, 6)));

        const ey = Number(expRaw.slice(0, 2));
        const expYear = ey <= 69 ? 2000 + ey : 1900 + ey;
        const expiryDate = createDateValue(expYear, Number(expRaw.slice(2, 4)), Number(expRaw.slice(4, 6)));

        if (birthDate && expiryDate) {
            return { issueDate: '', expiryDate, birthDate, cinsiyet, passportNumber };
        }
        if (expiryDate && expiryDate >= '2020-01-01' && expiryDate <= '2045-12-31') {
            return { issueDate: '', expiryDate, birthDate: birthDate || '', cinsiyet, passportNumber };
        }
    }

    return { issueDate: '', expiryDate: '', birthDate: '', cinsiyet, passportNumber };
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
        } else if (issueDate > expiryDate && expiryDate <= '2025-01-01' && issueDate > '2025-01-01') {
            const temp = issueDate;
            issueDate = expiryDate;
            expiryDate = temp;
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
    // English / Commonwealth / Pakistan
    'place of birth', 'birth place', 'city of birth', 'town of birth', 'village of birth', 'district of birth',
    'place of origin', 'pob', 'country / place of birth', 'place of birth / country of birth',
    'country of birth / place of birth', 'place / country of birth', 'country / city of birth',
    'place and country of birth', 'place & country of birth', 'country of birth', 'district', 'domicile',
    // French
    'lieu de naissance', 'lieu d\'origine', 'lieu d origine', 'lieu naissance', 'place/lieu de naissance',
    // Turkish / Azeri
    'doğum yeri', 'dogum yeri', 'doğduğu yer', 'dogdugu yer', 'doğulduğu yer', 'doguldugu yer',
    // Afghan Pashto
    'د زیږیدنې ځای', 'د زیږیدنی ځای', 'د زېږېدو ځای', 'د زیږیدو ځای', 'د تولد ځای', 'د زوکړې ځای', 'د زوکړی ځای', 'د زېږېدنې ځای',
    // Afghan Dari / Persian
    'محل تولد', 'محل پیدایش', 'مكان تولد', 'مكان پیدایش', 'ولایت تولد', 'زادگاه',
    // Combined Afghan / Dari / Pashto
    'د زیږیدنې ځای / محل تولد', 'محل تولد / د زیږیدنې ځای',
    // Urdu / Pakistan
    'مقام پیدائش', 'جائے پیدائش', 'پیدائش کا مقام', 'جای پیدائش',
    // Arabic
    'مكان الميلاد', 'محل الميلاد', 'مكان الولادة', 'محل الولادة', 'مكان الازدياد', 'مكان الإزدياد',
    'محل الازدياد', 'مكان وتاريخ الميلاد', 'مكان وتاريخ الولادة', 'تاريخ ومكان الميلاد', 'تاريخ ومكان الولادة',
    'محل وتاريخ الولادة', 'محل وتاريخ الميلاد',
    // Russian / Cyrillic
    'место рождения', 'место рождения / place of birth', 'место рожд.', 'место рожд', 'место рождения / lieu de naissance',
    'место и дата рождения', 'дата и место рождения',
    'туған жері', 'туған жер', 'туған жері / place of birth', 'туган жери', 'туулган жери',
    'ҷои таваллуд', 'чои таваллуд', 'ҷойи таваллуд', 'туғилган жойи', 'доглан йери', 'доглан ери',
    'місце народження', 'места нараджэння', 'место на раждане', 'место на раждање',
    // Uzbek / Turkmen Latin
    'tug\'ilgan joyi', 'tugilgan joyi', 'tug\'ilgan joy', 'doglan ýeri', 'doglan yeri',
    // Other European / African
    'geburtsort', 'lugar de nacimiento', 'lugar y fecha de nacimiento', 'local de nascimento', 'luogo di nascita',
    'goobta dhallashada', 'goobta dhalashada'
];

const POB_STOP_WORDS = [
    // English
    'date of birth', 'date of issue', 'date of expiry', 'date', 'issue', 'issuing', 'expiry', 'expiration', 'valid until', 'valid', 'sex', 'gender', 'authority', 'issued by', 'signature', 'nationality', 'national',
    // French
    'date de naissance', 'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date d expiration', 'date', 'sexe', 'autorité', 'autorite', 'delivre par', 'signature', 'nationalité', 'nationalite',
    // Turkish
    'doğum tarihi', 'dogum tarihi', 'veriliş tarihi', 'verilis tarihi', 'verildiği tarih', 'verildigi tarih', 'verildiği', 'verildigi', 'tanzim tarihi', 'düzenlenme tarihi', 'duzenlenme tarihi', 'düzenleme tarihi', 'duzenleme tarihi', 'düzenlenme', 'duzenlenme', 'düzenleme', 'duzenleme', 'geçerlilik tarihi', 'gecerlilik tarihi', 'son geçerlilik', 'tarih', 'tarihi', 'cinsiyet', 'veren makam', 'makam', 'imza', 'uyruk', 'uyruğu',
    // Russian
    'дата рождения', 'дата выдачи', 'срок действия', 'действителен до', 'дата', 'пол', 'орган выдачи', 'кем выдан', 'подпись', 'гражданство', 'национальность',
    // Arabic / Dari / Pashto
    'تاريخ الميلاد', 'تاريخ الاصدار', 'تاريخ الإصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ النفاذ', 'تاريخ', 'الجنس', 'النوع', 'المهنة', 'السلطة', 'الجهة', 'الرقم الوطني', 'الرقم القومي', 'الجنسية', 'التوقيع', 'حامل',
    // Other Turkic/Cyrillic
    'amal', 'sana', 'sanasi', 'beril', 'berilgan', 'qoldanylu', 'mohleti', 'möhleti', 'etibarliliq', 'jynsy', 'jinsi'
];

const AUTHORITY_LABELS = [
    // English / Pakistan / Commonwealth
    'issuing authority', 'issuing office', 'office of issue', 'place of issue', 'issued by', 'authority', 'passport office',
    'regional passport office', 'rpo',
    'issuing state', 'issuing post', 'issuing country', 'issuing government',
    // French
    'autorité de délivrance', 'autorite de delivrance', 'autorité', 'autorite', 'délivré par', 'delivre par', 'lieu de délivrance', 'lieu de delivrance',
    'délivré à', 'delivre a',
    // Turkish / Azeri
    'belgeyi veren makam', 'pasaportu veren makam', 'tanzim eden makam', 'düzenleyen makam', 'duzenleyen makam', 'veren makam', 'verildiği yer', 'verildigi yer',
    'verən makam', 'verən orqan', 'tərtib edən orqan',
    // Afghan Pashto
    'د صادرولو مرجع', 'د صادرولو ځای', 'د ورکړې مرجع', 'د ورکړی ځای', 'د ورکړې ځای', 'صادرونکی اداره', 'اداره صادر کننده',
    // Afghan Dari / Persian
    'مرجع صادر کننده', 'مرجع صادرکننده', 'مرجع صدور', 'مقام صدور', 'اداره صادر کننده', 'اداره صادرکننده', 'محل صدور',
    // Combined Afghan
    'مرجع صدور / د صادرولو مرجع / issuing authority', 'مرجع صدور / د صادرولو مرجع', 'د صادرولو ځای / مرجع صدور',
    // Urdu / Pakistan
    'سلطۂ اجرا', 'سلطه اجرا', 'مجاز دفتر', 'جاری کنندہ دفتر', 'جاری کنندہ', 'جاری کنندھ', 'دفتر اجرا', 'جاری کرنے والا ادارہ',
    // Arabic
    'جهة الإصدار', 'جهة الاصدار', 'الجهة المصدرة', 'الجهة المصدرة للوثيقة', 'مكان الإصدار', 'مكان الاصدار', 'مكان الصدور', 'مكان التحرير',
    'سلطة الإصدار', 'سلطة الاصدار', 'السلطة', 'مركز الإصدار', 'مركز الاصدار', 'صدر عن', 'صدرت من',
    'مكان وتاريخ الإصدار', 'مكان وتاريخ الاصدار', 'تاريخ ومكان الإصدار', 'تاريخ ومكان الاصدار',
    'دائرة الهجرة والجوازات', 'مصلحة الهجرة والجوازات', 'مصلحة الجوازات', 'إدارة الجوازات', 'ادارة الجوازات',
    // Russian / Cyrillic / CIS
    'орган выдачи / issuing authority', 'кем выдан / authority',
    'орган, выдавший документ', 'орган выдавший документ', 'орган выдачи', 'орган, що видав документ', 'орган що видав',
    'орган що видав паспорт', 'кем выдан', 'выдан', 'выдавший орган', 'паспорт выдан', 'документ выдан', 'выдано',
    'берген орган', 'берген мекеме', 'берген жай', 'берілген жер', 'берілген жері', 'берілген күні мен органы',
    'мақоми васиқадиҳанда', 'макоми васикадиханда', 'орган, ки васиқа додааст', 'орган ки васика додааст', 'швкд', 'рвкд', 'вкд',
    'ким томонидан берилган', 'берган organ', 'берган орган', 'берилган жойи',
    'ким тарапындан берлен', 'берлен ýeri', 'берlen ýeri', 'berlen ýeri', 'berlen yeri', 'berlən yeri', 'bergan organ', 'berlen wagty',
    'мамлекеттик каттоо кызматы',
    // Spanish / Portuguese / Italian / German
    'autoridad de expedición', 'autoridad expedidora', 'autoridad de emision', 'lugar de expedición', 'lugar de expedicion', 'expedido por', 'autoridad',
    'autoridade emissora', 'emitido por', 'autoridade',
    'autorità di rilascio', 'autorita di rilascio', 'rilasciato da', 'autorità', 'autorita',
    'ausstellende behörde', 'ausstellende behoerde', 'ausgestellt durch', 'passbehörde', 'passbehoerde', 'behörde', 'behoerde'
];

const AUTHORITY_STOP_WORDS = [
    'date of issue', 'date of expiry', 'date of birth', 'date of expiration', 'date of validity', 'valid until',
    'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date d expiration', 'date de naissance',
    'veriliş tarihi', 'verilis tarihi', 'verildiği tarih', 'verildigi tarih', 'verildiği', 'verildigi', 'düzenlenme tarihi', 'duzenlenme tarihi', 'düzenleme tarihi', 'duzenleme tarihi', 'düzenlenme', 'duzenlenme', 'düzenleme', 'duzenleme', 'geçerlilik tarihi', 'gecerlilik tarihi', 'son geçerlilik', 'doğum tarihi', 'dogum tarihi', 'tanzim tarihi',
    'дата выдачи', 'срок действия', 'дата окончания', 'действителен до', 'дата рождения',
    'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ النفاذ', 'تاريخ الميلاد',
    'fecha de expedicion', 'fecha de emision', 'fecha de caducidad', 'fecha de nacimiento',
    'data di rilascio', 'data di scadenza', 'data di nascita',
    'ausstellungsdatum', 'gueltig bis', 'gültig bis', 'geburtsdatum',
    'place of birth', 'lieu de naissance', 'doğum yeri', 'dogum yeri', 'место рождения', 'مكان الميلاد', 'lugar de nacimiento',
    'signature of bearer', 'bearer\'s signature', 'holder\'s signature', 'signature du titulaire', 'imza', 'sahibinin imzası', 'подпись владельца', 'подпись', 'التوقيع',
    'sex', 'gender', 'cinsiyet', 'sexe', 'пол', 'الجنس', 'sexo', 'sesso', 'geschlecht',
    'nationality', 'uyruk', 'uyruğu', 'nationalité', 'nationalite', 'гражданство', 'الجنسية',
    'passport no', 'passport number', 'no de passeport', 'pasaport no', 'номер паспорта', 'رقم الجواز',
    'berilgan sanasi', 'berilgen sanasi', 'berilgen kuni', 'berilgan vaqti', 'amal qilish muddati', 'amal qilish', 'sanasi', 'sana', 'kuni',
    'etibarlılıq müddəti', 'etibarliliq muddati', 'bitmə tarixi', 'bitme tarixi', 'verilmə tarixi', 'verilme tarixi',
    'qoldanylu merzimi', 'qoldanylu', 'mohleti', 'möhleti',
    'mrz'
];

const KNOWN_AUTHORITY_PATTERNS = [
    // Pakistan
    /\bDIRECTORATE GENERAL(?: OF)? IMMIGRATION (?:&|AND) PASSPORTS\b/i,
    /\bIMMIGRATION (?:&|AND) PASSPORTS\b/i,
    /\bDG\s*I(?:\s*&|\s*AND)\s*P\b/i,
    /\bDGI&P\b/i,
    /\bDGIP\b/i,
    /\bD\.G\.I\.P\.?\b/i,
    /\bIM&P\b/i,
    /\bREGIONAL PASSPORT OFFICE(?:\s+[A-Z]+)?\b/i,
    /\bRPO(?:\s+[A-Z]+)?\b/i,
    /\bGOVERNMENT OF PAKISTAN\b/i,
    /\bGOVT\.? OF PAKISTAN\b/i,
    /\bEMBASSY OF PAKISTAN(?:\s+[A-Z]+)?\b/i,
    /\bCONSULATE GENERAL OF PAKISTAN(?:\s+[A-Z]+)?\b/i,
    /\bPAKPERS\b/i,
    // Afghanistan
    /\bGENERAL DIRECTORATE OF PASSPORTS\b/i,
    /\bDIRECTORATE OF PASSPORTS\b/i,
    /\bPASSPORT DEPARTMENT\b/i,
    /\bKABUL PASSPORT OFFICE\b/i,
    /\bAFGHAN EMBASSY(?:\s+[A-Z]+)?\b/i,
    /\bEMBASSY OF AFGHANISTAN(?:\s+[A-Z]+)?\b/i,
    /\bAFGHAN CONSULATE GENERAL(?:\s+[A-Z]+)?\b/i,
    /(?:^|[\s:;#\-_/\\|.,])(?:د پاسپورت ریاست|ریاست پاسپورت)(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])(?:د کورنیو چارو وزارت|وزارت امور داخله)(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])(?:د بهرنیو چارو وزارت|وزارت امور خارجه)(?=$|[\s:;#\-_/\\|.,])/u,
    // General / English / French
    /\bDEPARTMENT OF STATE\b/i,
    /\bPASSPORT OFFICE\b/i,
    /\bMINISTRY OF FOREIGN AFFAIRS\b/i,
    /\bMINISTRY OF INTERIOR\b/i,
    /\bMINISTRY OF HOME AFFAIRS\b/i,
    /\bHM PASSPORT OFFICE\b/i,
    /\bDEPARTMENT OF HOME AFFAIRS\b/i,
    /\bIDENTITY AND PASSPORT SERVICE\b/i,
    /\bMINISTERE DE L'INTERIEUR\b/i,
    /\bMINISTERE DES AFFAIRES ETRANGERES\b/i,
    /\bDIRECTION GENERALE DE LA POLICE(?: NATIONALE)?\b/i,
    /\bPREFECTURE DE POLICE\b/i,
    /\bCOMMISSARIAT CENTRAL\b/i,
    // Turkey
    /\bNÜFUS VE VATANDAŞLIK İŞLERİ(?: GENEL MÜDÜRLÜĞÜ)?\b/i,
    /\bNUFUS VE VATANDASLIK ISLERI(?: GENEL MUDURLUGU)?\b/i,
    /\bEMNİYET GENEL MÜDÜRLÜĞÜ\b/i,
    /\bEMNIYET GENEL MUDURLUGU\b/i,
    /\bİL EMNİYET MÜDÜRLÜĞÜ\b/i,
    /\bIL EMNIYET MUDURLUGU\b/i,
    // Russia & CIS
    /(?:^|[\s:;#\-_/\\|.,])МВД(?:\s+РОССИИ|\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])ГУВМ\s+МВД(?:\s+РОССИИ)?(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])УФМС(?:\s+РОССИИ|\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])ФМС(?:\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])МИД(?:\s+РОССИИ)?(?=$|[\s:;#\-_/\\|.,])/u,
    /\bMIA OF RUSSIA\b/i,
    /\bMIA\s*\d{3,6}\b/i,
    /\bMVD(?:\s+OF\s+RUSSIA|\s*\d{3,6})?\b/i,
    /\bUFMS\s*\d{3,6}\b/i,
    /\bFMS\s*\d{3,6}\b/i,
    /\bMID OF RUSSIA\b/i,
    /\bMFA OF RUSSIA\b/i,
    /(?:^|[\s:;#\-_/\\|.,])ҚР\s+ІІМ(?=$|[\s:;#\-_/\\|.,])/u,
    /\bQR\s+IIM\b/i,
    /(?:^|[\s:;#\-_/\\|.,])ІІМ(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])МВД\s+РК(?=$|[\s:;#\-_/\\|.,])/u,
    /\bIIBB\b/i,
    /\bIIB\s+[A-Z\s]{2,20}\b/i,
    /\bIIV\b/i,
    /\bICHKI ISHLAR VAZIRLIGI\b/i,
    /(?:^|[\s:;#\-_/\\|.,])ВКД(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])РВКД(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])ШВКД(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])МВД\s+РТ(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])ВХИД(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])МКК(?:\s*\d{1,4})?(?=$|[\s:;#\-_/\\|.,])/u,
    /\bSRS\b/i,
    /(?:^|[\s:;#\-_/\\|.,])МВД\s+КР(?=$|[\s:;#\-_/\\|.,])/u,
    /\bSMST\b/i,
    /\bSTATE MIGRATION SERVICE OF TURKMENISTAN\b/i,
    // Arabic
    /(?:^|[\s:;#\-_/\\|.,])مصلحة الجوازات(?: والجنسية)?(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])مديرية الهجرة والجوازات(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])إدارة الهجرة والجوازات(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])ادارة الهجرة والجوازات(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])وزارة الداخلية(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])وزارة الخارجية(?=$|[\s:;#\-_/\\|.,])/u,
    /(?:^|[\s:;#\-_/\\|.,])مركز الإصدار(?=$|[\s:;#\-_/\\|.,])/u
];

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AFGHAN_CITIES = {
    'کابل': 'KABUL',
    'هرات': 'HERAT',
    'مزار شریف': 'MAZAR-I-SHARIF',
    'مزارشریف': 'MAZAR-I-SHARIF',
    'کندهار': 'KANDAHAR',
    'قندهار': 'KANDAHAR',
    'جلال اباد': 'JALALABAD',
    'جلال آباد': 'JALALABAD',
    'کندز': 'KUNDUZ',
    'قندوز': 'KUNDUZ',
    'بامیان': 'BAMYAN',
    'غزنی': 'GHAZNI',
    'بدخشان': 'BADAKHSHAN',
    'بغلان': 'BAGHLAN',
    'بلخ': 'BALKH',
    'پروان': 'PARWAN',
    'تخار': 'TAKHAR',
    'ننگرهار': 'NANGARHAR',
    'هلمند': 'HELMAND',
    'پکتیا': 'PAKTIA',
    'پکتیکا': 'PAKTIKA',
    'خوست': 'KHOST',
    'فراه': 'FARAH',
    'فاریاب': 'FARYAB',
    'جوزجان': 'JOWZJAN',
    'سمنگان': 'SAMANGAN',
    'سرپل': 'SAR-E POL',
    'لوگر': 'LOGAR',
    'وردک': 'WARDAK',
    'میدان وردک': 'WARDAK',
    'لغمان': 'LAGHMAN',
    'کاپیسا': 'KAPISA',
    'پنجشیر': 'PANJSHIR',
    'کنر': 'KUNAR',
    'نورستان': 'NURISTAN',
    'بادغیس': 'BADGHIS',
    'غور': 'GHOR',
    'نیمروز': 'NIMRUZ',
    'دایکندی': 'DAYKUNDI',
    'اروزگان': 'URUZGAN',
    'زابل': 'ZABUL'
};

const COMMON_COUNTRY_NAMES_OR_CODES = new Set([
    'RUSSIA', 'RUSSIAN FEDERATION', 'RUS', 'USSR', 'SOVIET UNION', 'SU',
    'PAKISTAN', 'PAK', 'ISLAMIC REPUBLIC OF PAKISTAN',
    'AFGHANISTAN', 'AFG', 'ISLAMIC REPUBLIC OF AFGHANISTAN', 'ISLAMIC EMIRATE OF AFGHANISTAN',
    'TURKEY', 'TURKIYE', 'TUR', 'TÜRKIYE', 'TURKİYE',
    'TURKMENISTAN', 'TKM', 'UZBEKISTAN', 'UZB', 'KAZAKHSTAN', 'KAZ',
    'KYRGYZSTAN', 'KGZ', 'TAJIKISTAN', 'TJK', 'AZERBAIJAN', 'AZE',
    'IRAN', 'IRN', 'IRAQ', 'IRQ', 'SYRIA', 'SYR', 'EGYPT', 'EGY',
    'SOMALIA', 'SOM', 'SUDAN', 'SDN', 'YEMEN', 'YEM', 'JORDAN', 'JOR',
    'LEBANON', 'LBN', 'PALESTINE', 'PSE', 'NIGERIA', 'NGA', 'GHANA', 'GHA',
    'INDIA', 'IND', 'BANGLADESH', 'BGD', 'INDONESIA', 'IDN', 'MALAYSIA', 'MYS',
    'GERMANY', 'DEU', 'FRANCE', 'FRA', 'UNITED KINGDOM', 'GBR', 'UK', 'USA'
]);

function isCountryNameOrCode(val) {
    if (!val) return false;
    const clean = String(val).replace(/[.,\-_/\\#()]/g, '').trim().toUpperCase();
    return COMMON_COUNTRY_NAMES_OR_CODES.has(clean);
}

function cleanPlaceOfBirthValue(rawValue) {
    if (!rawValue) return '';
    let val = String(rawValue).trim();

    // 1. Strip date if combined label (e.g. KHARTOUM 12/05/2001)
    val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();
    val = val.replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/gi, '').trim();

    // 2. Strip leading / trailing OCR artifacts
    val = val.replace(/^[«"'\(\[\{<]+|[»"'\)\]\}>]+$/g, '').trim();

    // 3. Strip Russian/Cyrillic administrative prefixes:
    val = val.replace(/^(?:Г\.|ГОР\.|ГОРОД|С\.|СЕЛО|П\.|ПОС\.|ПОСЕЛОК|ОБЛ\.|ОБЛАСТЬ|КРАЙ|РЕСП\.|РЕСПУБЛИКА|Р-Н\.|Р-Н|РАЙОН)(?:\s+|$|[.,:;])\s*/i, '');
    val = val.replace(/^(?:Г|С|П)(?:\s+|$|[.,:;])\s*/i, '');

    // 4. Strip Arabic administrative prefixes:
    val = val.replace(/^(?:محافظة|ولاية|مدينة|منطقة|بلدية|مركز|دائرة|ولایت)(?:\s+|$|[.,:;])\s*/i, '');

    // 5. Strip French / English administrative prefixes:
    val = val.replace(/^(?:VILLE DE|PROVINCE DE|REGION DE|COMMUNE DE|DEPARTEMENT DE|CITY OF|PROVINCE OF|STATE OF|DISTRICT OF)(?:\s+|$|[.,:;])\s*/i, '');

    // 6. Handle dual scripts separated by / or \ or |:
    // E.g.: "Г. МОСКВА / RUSSIA", "Г. САМАРА / USSR", "RAWALPINDI / PAKISTAN", "PAKISTAN / LAHORE", "کابل / KABUL"
    const parts = val.split(/\s*[/\\|]\s*/);
    if (parts.length >= 2) {
        // If one part is pure country name/code (e.g. RUSSIA, USSR, PAKISTAN) and the other is not, pick the non-country part!
        const nonCountryParts = parts.filter(p => !isCountryNameOrCode(p));
        if (nonCountryParts.length > 0 && nonCountryParts.length < parts.length) {
            const latinNonCountry = nonCountryParts.find(p => /[A-Za-z]/.test(p));
            val = latinNonCountry || nonCountryParts[0];
        } else {
            // Prefer Latin script for Turkish YÖKSİS compatibility
            const latinPart = parts.find(p => /[A-Za-z]/.test(p));
            val = latinPart || parts[0];
        }
    }

    // 7. Handle comma-separated city and country (e.g. "RAWALPINDI, PAKISTAN" -> "RAWALPINDI", "KABUL, AFGHANISTAN" -> "KABUL")
    const commaParts = val.split(/\s*,\s*/);
    if (commaParts.length >= 2) {
        if (isCountryNameOrCode(commaParts[commaParts.length - 1])) {
            val = commaParts.slice(0, commaParts.length - 1).join(' ').trim();
        } else if (isCountryNameOrCode(commaParts[0])) {
            val = commaParts.slice(1).join(' ').trim();
        }
    }

    // 8. Strip trailing country names like "- PAKISTAN", "/ PAKISTAN"
    val = val.replace(/\s*[-/]\s*(?:PAKISTAN|AFGHANISTAN|RUSSIA|RUSSIAN FEDERATION|USSR)\b/i, '').trim();

    // 9. Map Afghan cities in Dari / Pashto if exact or contained
    const trimmedVal = val.trim();
    if (AFGHAN_CITIES[trimmedVal]) {
        val = AFGHAN_CITIES[trimmedVal];
    } else {
        for (const [arCity, latCity] of Object.entries(AFGHAN_CITIES)) {
            if (trimmedVal.includes(arCity)) {
                val = latCity;
                break;
            }
        }
    }

    val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
    val = val.replace(/\s+/g, ' ');
    val = val.replace(/^(?:Г\.|ГОР\.|ГОРОД|Г)(?:\s+|$|[.,:;])\s*/i, '');
    val = val.replace(/^(?:محافظة|ولاية|مدينة|ولایت)(?:\s+|$|[.,:;])\s*/i, '');
    val = val.replace(/^(?:VILLE DE|CITY OF)(?:\s+|$|[.,:;])\s*/i, '');

    if (!val || val.length < 2 || /^\d+$/.test(val)) return '';
    return val;
}

function cleanIssuingAuthorityValue(rawValue) {
    if (!rawValue) return '';
    let val = String(rawValue).trim();

    // Remove dates
    val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();
    val = val.replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/gi, '').trim();

    // Clean OCR artifacts: brackets, guillemets, quotes, chevron fillers
    val = val.replace(/^[«"'\(\[\{<]+|[»"'\)\]\}>]+$/g, '').trim();
    val = val.replace(/<{2,}/g, ' ').replace(/</g, ' ');

    // Bilingual / dual-script splitting (e.g. "МВД 77001 / MIA 77001" or "ریاست پاسپورت / PASSPORT DEPARTMENT")
    const parts = val.split(/\s*[/\\|]\s*/);
    if (parts.length >= 2) {
        const latinPart = parts.find(p => /[A-Za-z]/.test(p) && !isLabelOnlyLine(p, AUTHORITY_LABELS));
        if (latinPart) {
            val = latinPart;
        } else {
            val = parts[parts.length - 1];
        }
    }

    // Strip leftover leading labels
    val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
    val = val.replace(/^(?:AUTHORITY|AUTORITE|ISSUING AUTHORITY|ISSUED BY|OFFICE|PASSPORT OFFICE|VEREN MAKAM|BELGEYI VEREN MAKAM|ОРГАН ВЫДАЧИ|КЕМ ВЫДАН|جهة الإصدار|جهة الاصدار|مرجع صدور|د صادرولو مرجع)\s*[:\-]?\s*/i, '');
    val = val.replace(/\s+/g, ' ');

    // Pakistani common abbreviations
    if (/^D\.?G\.?\s*I\.?\s*(?:&|AND)\s*P\.?$/i.test(val) || /^DGIP$/i.test(val)) {
        val = 'DGIP';
    } else if (/^IM\s*&\s*P$/i.test(val)) {
        val = 'IM&P';
    } else if (/^GOVT\.?\s+OF\s+PAKISTAN$/i.test(val)) {
        val = 'GOVERNMENT OF PAKISTAN';
    }

    // Afghan common labels in Dari/Pashto
    if (val === 'ریاست پاسپورت' || val === 'د پاسپورت ریاست') {
        val = 'PASSPORT DEPARTMENT';
    } else if (val === 'وزارت امور داخله' || val === 'د کورنیو چارو وزارت') {
        val = 'MINISTRY OF INTERIOR';
    } else if (val === 'وزارت امور خارجه' || val === 'د بهرنیو چارو وزارت') {
        val = 'MINISTRY OF FOREIGN AFFAIRS';
    }

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

        let labelIndex = -1;
        let labelLen = 0;
        const labelMatch = line.match(new RegExp(escapeRegex(foundLabel), 'iu'));
        if (labelMatch) {
            labelIndex = labelMatch.index;
            labelLen = labelMatch[0].length;
        } else {
            labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
            labelLen = foundLabel.length;
        }
        if (labelIndex === -1) continue;

        // 1. Check text BEFORE the label (for RTL / Arabic / Dari / Pashto or multi-column layouts, e.g. "کابل د زیږیدنې ځای")
        let beforeRemainder = line.slice(0, labelIndex).trim();
        beforeRemainder = beforeRemainder.replace(/^[«"'\(\[\{]+|[»"'\)\]\}]+$/g, '').trim();
        let candidateBefore = '';
        if (beforeRemainder.length >= 2 && !isLabelOnlyLine(beforeRemainder, POB_LABELS) && !isLabelOnlyLine(beforeRemainder, POB_STOP_WORDS)) {
            for (const stop of POB_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = beforeRemainder.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined) {
                    beforeRemainder = beforeRemainder.slice(0, stopMatch.index).trim();
                }
            }
            const cleanedBefore = cleanPlaceOfBirthValue(beforeRemainder);
            if (cleanedBefore && !isLabelOnlyLine(cleanedBefore, POB_LABELS)) {
                candidateBefore = cleanedBefore;
            }
        }

        // 2. Check text AFTER the label
        let remainder = line.slice(labelIndex + labelLen);

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

        if (candidateBefore) {
            return candidateBefore.toUpperCase();
        }

        // 3. Multi-line search after label
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            if (!nextLine) continue;

            if (isLabelOnlyLine(nextLine, POB_LABELS)) continue;
            if (isLabelOnlyLine(nextLine, POB_STOP_WORDS)) break;
            if (AUTHORITY_LABELS.some(l => {
                const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                return regex.test(nextLine);
            })) break;

            if (/\b(?:\d{4}[./\-]\d{1,2}[./\-]\d{1,2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/.test(nextLine)) {
                break;
            }

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

        if (candidateBefore) {
            return candidateBefore.toUpperCase();
        }
    }

    // Heuristic fallback for Pakistani / Afghan major cities if OCR missed the label
    const isPakistani = nationalityCheck.includes('PAK') || upperText.includes('PAKISTAN');
    const isAfghan = nationalityCheck.includes('AFG') || upperText.includes('AFGHANISTAN');
    if (isAfghan) {
        for (const [arCity, latCity] of Object.entries(AFGHAN_CITIES)) {
            if (text.includes(arCity) || upperText.includes(latCity)) {
                return latCity;
            }
        }
    }
    if (isPakistani) {
        const pakCities = ['ISLAMABAD', 'RAWALPINDI', 'LAHORE', 'KARACHI', 'PESHAWAR', 'QUETTA', 'MULTAN', 'FAISALABAD', 'SIALKOT', 'GUJRANWALA', 'HYDERABAD'];
        for (const city of pakCities) {
            if (new RegExp('\\b' + city + '\\b', 'i').test(upperText)) {
                return city;
            }
        }
    }

    return '';
}

export function extractPassportIssuingAuthority(text, options = {}) {
    if (!text || typeof text !== 'string') {
        const fallbackIso = getCountryIso3Code(
            options.uyruk || options.nationality || options.country || options.dogumUlkesi
        );
        if (fallbackIso === 'PAK') return 'PAKISTAN';
        if (fallbackIso === 'AFG') return 'PASSPORT DEPARTMENT';
        if (fallbackIso === 'RUS') return 'MIA OF RUSSIA';
        if (fallbackIso === 'TKM') return 'SMST';
        return fallbackIso || '';
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

        let labelIndex = -1;
        let labelLen = 0;
        const labelMatch = line.match(new RegExp(escapeRegex(foundLabel), 'iu'));
        if (labelMatch) {
            labelIndex = labelMatch.index;
            labelLen = labelMatch[0].length;
        } else {
            labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
            labelLen = foundLabel.length;
        }
        if (labelIndex === -1) continue;

        // Check text BEFORE the label (RTL / Arabic or multi-column table layout: e.g. "دمشق جهة الإصدار")
        let beforeRemainder = line.slice(0, labelIndex).trim();
        beforeRemainder = beforeRemainder.replace(/^[«"'\(\[\{]+|[»"'\)\]\}]+$/g, '').trim();
        let candidateBefore = '';
        if (beforeRemainder.length >= 2 && !isLabelOnlyLine(beforeRemainder, AUTHORITY_LABELS) && !isLabelOnlyLine(beforeRemainder, AUTHORITY_STOP_WORDS)) {
            for (const stop of AUTHORITY_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = beforeRemainder.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined) {
                    beforeRemainder = beforeRemainder.slice(0, stopMatch.index).trim();
                }
            }
            const cleanedBefore = cleanIssuingAuthorityValue(beforeRemainder);
            if (cleanedBefore && !isLabelOnlyLine(cleanedBefore, AUTHORITY_LABELS)) {
                candidateBefore = cleanedBefore;
            }
        }

        // Check text AFTER the label
        let remainder = line.slice(labelIndex + labelLen);
        let keepStripping = true;
        while (keepStripping) {
            keepStripping = false;
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
            for (const l of AUTHORITY_LABELS) {
                if (l === 'regional passport office' || l === 'passport office') continue;
                const r = new RegExp('^' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                if (r.test(remainder)) {
                    remainder = remainder.replace(r, '').trim();
                    keepStripping = true;
                    break;
                }
            }
        }
        remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

        const collectedLineValues = [];

        if (remainder.length >= 2) {
            for (const stop of AUTHORITY_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = remainder.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                    remainder = remainder.slice(0, stopMatch.index).trim();
                }
            }
            const cleaned = cleanIssuingAuthorityValue(remainder);
            if (cleaned) collectedLineValues.push(cleaned);
        }

        // Multi-line collection: check up to 3 lines following the label
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            if (!nextLine) continue;

            if (isLabelOnlyLine(nextLine, AUTHORITY_LABELS)) continue;
            if (isLabelOnlyLine(nextLine, AUTHORITY_STOP_WORDS)) break;

            // If next line contains a date, it is a date field (issue/expiry/birth), not an authority name continuation
            if (/\b(?:\d{4}[./\-]\d{1,2}[./\-]\d{1,2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/.test(nextLine) ||
                /\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/i.test(nextLine)) {
                break;
            }

            let val = nextLine;
            let hitStop = false;
            for (const stop of AUTHORITY_STOP_WORDS) {
                const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                const stopMatch = val.match(stopRegex);
                if (stopMatch && stopMatch.index !== undefined) {
                    if (stopMatch.index === 0) {
                        hitStop = true;
                        break;
                    }
                    val = val.slice(0, stopMatch.index).trim();
                }
            }
            if (hitStop) break;

            const cleaned = cleanIssuingAuthorityValue(val);
            if (cleaned) {
                collectedLineValues.push(cleaned);
            }
        }

        if (collectedLineValues.length > 0) {
            // Check if we have bilingual dual-script across collected lines
            // (e.g. Line 1 Cyrillic/Arabic, Line 2 Latin). If so, prefer Latin for YÖKSİS!
            const latinLines = collectedLineValues.filter(l => /[A-Za-z]/.test(l) && !isLabelOnlyLine(l, AUTHORITY_LABELS));
            if (latinLines.length > 0 && latinLines.length < collectedLineValues.length) {
                return latinLines.join(' ').toUpperCase();
            }
            return collectedLineValues.join(' ').toUpperCase();
        }

        if (candidateBefore) {
            return candidateBefore.toUpperCase();
        }
    }

    // Fallback: Known Authority Patterns
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length < 3) continue;
        for (const pattern of KNOWN_AUTHORITY_PATTERNS) {
            const match = trimmed.match(pattern);
            if (match) {
                const cleaned = cleanIssuingAuthorityValue(match[0]);
                if (cleaned) return cleaned.toUpperCase();
            }
        }
    }

    // Fallback: MRZ Country Code
    const cleanMrzText = normalized.replace(/[«‹([{]/g, '<').toUpperCase();
    const mrzMatch = cleanMrzText.match(/(?:^|[^A-Z0-9])P<([A-Z]{3})/i)
        || cleanMrzText.match(/(?:^|[^A-Z0-9])P[<A-Z0-9]<([A-Z]{3})/i);
    const mrzIso = (mrzMatch && mrzMatch[1] !== 'UTO' && mrzMatch[1] !== 'XXX') ? mrzMatch[1] : '';

    const fallbackIso = mrzIso || getCountryIso3Code(
        options.uyruk || options.nationality || options.country || options.dogumUlkesi
    );

    if (fallbackIso === 'PAK') return 'PAKISTAN';
    if (fallbackIso === 'AFG') return 'PASSPORT DEPARTMENT';
    if (fallbackIso === 'RUS') return 'MIA OF RUSSIA';
    if (fallbackIso === 'TKM') return 'SMST';

    return fallbackIso || '';
}

const GENDER_LABELS = [
    // English
    'sex', 'gender',
    // French
    'sexe',
    // Turkish
    'cinsiyet', 'cinsiyeti',
    // Russian / Cyrillic
    'пол', 'жынысы', 'жынсы',
    // Arabic
    'الجنس', 'النوع',
    // German
    'geschlecht',
    // Spanish / Portuguese
    'sexo',
    // Italian
    'sesso',
    // Uzbek / Central Asian Latin
    'jinsi', 'jynsy'
];

export function extractPassportGender(text, options = {}) {
    if (!text || typeof text !== 'string') return '';

    // 1. Try MRZ first
    const mrz = extractDatesFromMrz(text, options);
    if (mrz.cinsiyet) return mrz.cinsiyet;

    // 2. Search label-based sex fields
    const normalized = normalizeDocumentText(text);
    const lines = normalized.split(/[\r\n]+/);

    const maleRegex = /(?:^|[\s:;#\-_/\\|.,])(?:M|MALE|ERKEK|HOMME|MASCULIN|MASCULINO|MAENNLICH|MÄNNLICH|М|МУЖ|МУЖСКОЙ|МУЖЧИНА|ЕРКЕК|ЭРКЕК|МАРД|ذكر)(?:$|[\s:;#\-_/\\|.,])/i;
    const femaleRegex = /(?:^|[\s:;#\-_/\\|.,])(?:F|FEMALE|KADIN|KIZ|FEMME|FEMININ|FEMENINO|WEIBLICH|W|Ж|ЖЕН|ЖЕНСКИЙ|ЖЕНЩИНА|ӘЙЕЛ|АЯЛ|ЗАН|انثى|أنثى)(?:$|[\s:;#\-_/\\|.,])/i;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const foundLabel = GENDER_LABELS.find(l => {
            const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
            return regex.test(line);
        });

        if (!foundLabel) continue;

        let labelIndex = -1;
        let labelLen = 0;
        const labelMatch = line.match(new RegExp(escapeRegex(foundLabel), 'iu'));
        if (labelMatch) {
            labelIndex = labelMatch.index;
            labelLen = labelMatch[0].length;
        } else {
            labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
            labelLen = foundLabel.length;
        }
        if (labelIndex === -1) continue;
        let remainder = line.slice(labelIndex + labelLen).trim();
        remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

        // If bilingual label header like "Sex / Sexe" or "Sex / Пол", strip following labels
        let keepStripping = true;
        while (keepStripping) {
            keepStripping = false;
            for (const l of GENDER_LABELS) {
                const r = new RegExp('^[\\s:;#\-_/\\\\|.,]*' + escapeRegex(l), 'i');
                if (r.test(remainder)) {
                    remainder = remainder.replace(r, '').trim();
                    keepStripping = true;
                    break;
                }
            }
        }
        remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

        // Ignore generic placeholders like "M/F" or "E/K" or "М/Ж"
        if (/^(?:M\/F|F\/M|E\/K|K\/E|М\/Ж|Ж\/М)$/i.test(remainder)) {
            remainder = '';
        }

        if (remainder) {
            const firstToken = remainder.split(/[\s/\\,.;:-]+/)[0].trim();
            if (firstToken) {
                if (maleRegex.test(` ${firstToken} `)) return 'Erkek';
                if (femaleRegex.test(` ${firstToken} `)) return 'Kadın';
            }
            if (maleRegex.test(` ${remainder} `)) return 'Erkek';
            if (femaleRegex.test(` ${remainder} `)) return 'Kadın';
        }

        // Check next line if value is below label
        if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine && !GENDER_LABELS.some(l => nextLine.toLowerCase().includes(l.toLowerCase()))) {
                const firstToken = nextLine.split(/[\s/\\,.;:-]+/)[0].trim();
                if (firstToken) {
                    if (maleRegex.test(` ${firstToken} `)) return 'Erkek';
                    if (femaleRegex.test(` ${firstToken} `)) return 'Kadın';
                }
            }
        }
    }

    return '';
}

export function extractPassportMetadata(text, options = {}) {
    const dates = extractPassportDatesFromText(text, options);
    const placeOfBirth = extractPassportPlaceOfBirth(text, options);
    const issuingAuthority = extractPassportIssuingAuthority(text, options);
    const cinsiyet = extractPassportGender(text, options);
    const mrz = extractDatesFromMrz(text, options);

    return {
        issueDate: dates.issueDate || '',
        expiryDate: dates.expiryDate || '',
        placeOfBirth: placeOfBirth || '',
        issuingAuthority: issuingAuthority || '',
        cinsiyet: cinsiyet || '',
        passportNumber: mrz.passportNumber || ''
    };
}
